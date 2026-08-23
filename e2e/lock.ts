/**
 * One e2e suite per machine.
 *
 * Per-checkout ports (`scripts/lib/checkout-ports.ts`) and per-checkout state
 * (`e2e/state-dir.ts`) between them let two suites run side by side without
 * touching each other's files or sockets. That is the problem those two solve,
 * and it is not this one: a second suite is still a second `vite preview` and a
 * second workerd competing for the same cores, and this suite's timing
 * assertions are load-dominated. Two runs on one laptop do not fail on contended
 * *resources* any more — they fail on contended *CPU*, a whole spec file at a
 * time, in a pattern that reads exactly like a real regression.
 *
 * Measured on 2026-08-23: two suites overlapping produced 23 failures in one and
 * 33 in the other, with failure sets that barely intersected and whole files
 * flipping between runs. Neither number meant anything.
 *
 * So the isolation work above is deliberately *not* extended into letting the
 * suites overlap. This refuses the second one, by name and path, before it has
 * spent five minutes building.
 *
 * Held across two processes: `e2e/prepare.ts` takes it, `e2e/run.ts` adopts it
 * and releases it when Playwright has exited. The handoff is what `stage`
 * records — a lock left by a finished `prepare` is claimable by a `run` from the
 * same checkout, and by nothing else.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from './state-dir';

/**
 * Machine-wide on purpose: the point is to catch the *other* checkout, so it
 * cannot live inside either one.
 *
 * Read from the environment on every call rather than captured at import, so
 * `lock.spec.ts` can point at a scratch file. A spec that exercised the real
 * path would delete the lock out from under whatever suite happened to be
 * running on the machine at the time — the precise failure this module exists
 * to prevent.
 */
function lockFile(): string {
	return process.env.CORVMC_E2E_LOCK_FILE || join(tmpdir(), 'corvmc-e2e.lock');
}

/**
 * How long a lock whose owner is gone stays respected.
 *
 * A dead pid is almost always a crashed run, but it is also the normal state
 * during the `prepare` → `run` handoff, which takes milliseconds. Rather than
 * special-case the gap, anything dead and older than this is simply stale.
 */
const STALE_AFTER_MS = 60_000;

type Stage = 'prepare' | 'run';

type Lock = {
	pid: number;
	root: string;
	stage: Stage;
	startedAt: number;
};

function read(): Lock | null {
	const file = lockFile();
	if (!existsSync(file)) return null;
	try {
		const lock = JSON.parse(readFileSync(file, 'utf8')) as Lock;
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

function stale(lock: Lock): boolean {
	if (alive(lock.pid)) return false;
	return Date.now() - lock.startedAt > STALE_AFTER_MS;
}

function write(stage: Stage): void {
	const file = lockFile();
	mkdirSync(dirname(file), { recursive: true });
	const lock: Lock = { pid: process.pid, root: REPO_ROOT, stage, startedAt: Date.now() };
	writeFileSync(file, JSON.stringify(lock), 'utf8');
}

function refuse(lock: Lock): never {
	const where = lock.root === REPO_ROOT ? 'this checkout' : lock.root;
	throw new Error(
		[
			`Another e2e run is already active — refusing to start a second one.`,
			``,
			`  holder:  pid ${lock.pid} (${lock.stage}) in ${where}`,
			`  started: ${new Date(lock.startedAt).toLocaleTimeString()}`,
			``,
			`Two suites on one machine do not collide on ports or state any more, but`,
			`they do compete for CPU, and this suite's assertions are load-dominated —`,
			`both runs come back with failures that look like regressions and are not.`,
			``,
			`Wait for that run to finish, or if it is gone:`,
			``,
			`  rm ${lockFile()}`,
			``
		].join('\n')
	);
}

/**
 * Take the lock for `stage`, or throw explaining who holds it.
 *
 * `run` adopts a `prepare` lock from the same checkout — that is the handoff,
 * not a collision.
 */
export function acquireE2eLock(stage: Stage): void {
	const held = read();

	if (held && !stale(held)) {
		const handoff = stage === 'run' && held.stage === 'prepare' && held.root === REPO_ROOT;
		if (!handoff) refuse(held);
	}

	write(stage);
}

/** Drop the lock if this process still owns it. Safe to call more than once. */
export function releaseE2eLock(): void {
	const held = read();
	if (!held || held.pid !== process.pid) return;
	rmSync(lockFile(), { force: true });
}

/** Release on the way out, however this process is leaving. */
export function releaseE2eLockOnExit(): void {
	process.on('exit', releaseE2eLock);
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
		process.on(signal, () => {
			releaseE2eLock();
			process.exit(1);
		});
	}
}

/** Exposed for the spec, and for the message above. */
export { lockFile as e2eLockFile };
