/**
 * One full unit suite per machine — queued, not refused.
 *
 * `vite.config.ts` already halves `maxWorkers` off `availableParallelism()` on a
 * developer machine, and the comment there names this exact hazard. But that is a
 * per-process guess with nothing coordinating the processes: on eight cores one
 * suite takes four workers as intended, and **two suites take all eight**, plus a
 * headless-chromium pool each for the `client` and `storybook` projects. Measured
 * on 2026-08-30: two suites from sibling worktrees, 29 chromium shells, load
 * average 52, and a `vite dev` on the same box that could not answer a request
 * inside sixty seconds.
 *
 * `e2e/lock.ts` solved the same contention for the e2e suite and this is
 * deliberately its sibling — with one difference that is the whole design:
 *
 * > **e2e refuses a second run. This one waits for its turn.**
 *
 * e2e refuses because a second suite is not merely slow, it is wrong: the runs
 * share database state and the assertions are load-dominated, so a queued run
 * would still be worth nothing. Unit tests share no state. Two of them produce
 * the same results as one, only four times slower — so the second run is
 * legitimate and queueing it is lossless. Refusing it would turn "your colleague
 * is testing" into a red suite, which is a worse failure than waiting.
 *
 * Per-checkout ports (`browserPort`/`storybookPort` with `strictPort`) already
 * stop the two runs colliding on a socket. That is what made this worth
 * building: the collision that used to be loud is now silent, so the only
 * remaining symptom is that everything on the machine gets slow, which is the
 * kind of problem that recurs for weeks without being named.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `scripts/lib` → `scripts` → the checkout root. */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Machine-wide on purpose: the point is to see the *other* checkout, so it
 * cannot live inside either one.
 *
 * Read from the environment on every call rather than captured at import, so the
 * spec can point at a scratch file. A spec that exercised the real path would
 * delete the lock out from under whatever suite was running on the machine —
 * including, most likely, the very run executing that spec.
 */
export function unitLockFile(): string {
	return process.env.CORVMC_UNIT_LOCK_FILE || join(tmpdir(), 'corvmc-unit.lock');
}

/**
 * How long a lock whose owner is gone stays respected.
 *
 * A dead pid is a crashed or killed run — `vitest` taking a SIGKILL from the OOM
 * killer is the case this exists for, since that is exactly what over-subscribing
 * the machine causes. Short enough that a crash does not block the next run for
 * long; long enough not to race a process that is still starting up.
 */
export const STALE_AFTER_MS = 60_000;

export type UnitLock = {
	pid: number;
	root: string;
	startedAt: number;
};

function read(): UnitLock | null {
	const file = unitLockFile();
	if (!existsSync(file)) return null;
	try {
		const lock = JSON.parse(readFileSync(file, 'utf8')) as UnitLock;
		if (typeof lock?.pid !== 'number' || typeof lock?.root !== 'string') return null;
		return lock;
	} catch {
		// A truncated or hand-edited lock is not something to abort a run over.
		return null;
	}
}

function alive(pid: number): boolean {
	try {
		// Signal 0 tests for the process without touching it.
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Held by something that is gone, and gone long enough to be sure. */
export function isStale(lock: UnitLock, now = Date.now()): boolean {
	if (alive(lock.pid)) return false;
	return now - lock.startedAt > STALE_AFTER_MS;
}

/**
 * Claim the file, or report that somebody else already has it.
 *
 * `wx` is the whole of the mutual exclusion: it creates only if the path does
 * not exist, and the check and the create are one syscall. The read-then-write
 * pair this would otherwise be has a window between them wide enough for two
 * suites starting together — which, when a person kicks off two worktrees from
 * one prompt, is precisely when they start.
 */
function claim(): boolean {
	const file = unitLockFile();
	mkdirSync(dirname(file), { recursive: true });
	const lock: UnitLock = { pid: process.pid, root: REPO_ROOT, startedAt: Date.now() };
	try {
		writeFileSync(file, JSON.stringify(lock), { encoding: 'utf8', flag: 'wx' });
		return true;
	} catch {
		return false;
	}
}

/** Clear a lock we have judged stale, but only if it has not changed underneath us. */
function evict(stale: UnitLock): void {
	const current = read();
	if (current && current.pid === stale.pid && current.startedAt === stale.startedAt) {
		rmSync(unitLockFile(), { force: true });
	}
}

export type AcquireResult = 'acquired' | 'timed-out';

export type AcquireOptions = {
	/** How long to queue before giving up and running anyway. */
	waitMs?: number;
	/** How often to retry. */
	pollMs?: number;
	/** Called once, with the holder, if we actually have to wait. */
	onWait?: (holder: UnitLock) => void;
	/** Injectable for the spec. */
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
};

/**
 * Take the lock, waiting for whoever holds it.
 *
 * Returns `'timed-out'` rather than throwing when the wait is exhausted, and the
 * caller runs anyway. That is deliberate: the cost of overlapping is slowness,
 * never a wrong answer, so the worst case degrades to the behaviour we have
 * today instead of inventing a new way for a legitimate test run to fail.
 */
export async function acquireUnitLock(options: AcquireOptions = {}): Promise<AcquireResult> {
	const {
		waitMs = 15 * 60_000,
		pollMs = 500,
		onWait,
		now = () => Date.now(),
		sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
	} = options;

	const deadline = now() + waitMs;
	let announced = false;
	let sawUnreadable = false;

	for (;;) {
		if (claim()) return 'acquired';

		const held = read();

		if (held) {
			sawUnreadable = false;

			if (isStale(held, now())) {
				evict(held);
				continue;
			}

			if (!announced) {
				onWait?.(held);
				announced = true;
			}
		} else if (sawUnreadable) {
			// Present for at least a full poll and still not a lock we can read.
			// A live holder writes its whole record in one `wx` call, so a torn
			// read heals within one interval; anything that survives that is
			// garbage and would otherwise block every future run forever.
			rmSync(unitLockFile(), { force: true });
			continue;
		} else {
			// Could be a torn read, or the file could have vanished between the
			// failed claim and the read. Either way, come back once before
			// deleting anything.
			sawUnreadable = true;
		}

		// Every path that did not `continue` falls through to here, so the
		// deadline is always checked and the loop always sleeps — an unreadable
		// lock used to spin the CPU flat out instead, which is a rich way for a
		// module about CPU contention to fail.
		if (now() >= deadline) return 'timed-out';
		await sleep(pollMs);
	}
}

/** Drop the lock if this process still owns it. Safe to call more than once. */
export function releaseUnitLock(): void {
	const held = read();
	if (!held || held.pid !== process.pid) return;
	rmSync(unitLockFile(), { force: true });
}

/** Release on the way out, however this process is leaving. */
export function releaseUnitLockOnExit(): void {
	process.on('exit', releaseUnitLock);
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
		process.on(signal, () => {
			releaseUnitLock();
			process.exit(1);
		});
	}
}
