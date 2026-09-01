/**
 * The unit lock's state machine, exercised against a scratch file.
 *
 * `CORVMC_UNIT_LOCK_FILE` is set before anything reads it: touching the real
 * machine-wide path would delete the lock out from under whatever suite happened
 * to be running — which, for this file, is very likely the run executing it.
 *
 * `acquireUnitLock` takes its clock and its sleep as options, so waiting and
 * timing out are tested without the spec ever sleeping.
 */
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	acquireUnitLock,
	isStale,
	releaseUnitLock,
	unitLockFile,
	REPO_ROOT,
	STALE_AFTER_MS,
	type UnitLock
} from './unit-lock';

const SCRATCH = mkdtempSync(join(tmpdir(), 'corvmc-unit-lock-spec-'));
const LOCK = join(SCRATCH, 'unit.lock');

// `unit-lock.ts` resolves the path on every call rather than capturing it at
// import, so setting this beside plain static imports is enough — and avoids the
// in-test `await import` that costs a cold `.vite` cache its 5s budget.
process.env.CORVMC_UNIT_LOCK_FILE = LOCK;

/** A pid that cannot be alive: the kernel rejects it before it looks anything up. */
const DEAD_PID = 2 ** 31 - 1;

function writeLock(lock: Partial<UnitLock> = {}): UnitLock {
	const full: UnitLock = {
		pid: DEAD_PID,
		root: '/somewhere/else',
		startedAt: Date.now(),
		...lock
	};
	writeFileSync(LOCK, JSON.stringify(full), 'utf8');
	return full;
}

function readLock(): UnitLock {
	return JSON.parse(readFileSync(LOCK, 'utf8')) as UnitLock;
}

/**
 * Never actually waits — the loop's clock and sleep are injected.
 *
 * The clock starts at the real `Date.now()` rather than zero so it stays
 * comparable with the `startedAt` on lock records, which are stamped for real.
 * Starting at zero makes every staleness subtraction hugely negative, so a lock
 * abandoned an hour ago reads as freshly taken.
 */
function immediate(waitMs: number) {
	let clock = Date.now();
	return {
		waitMs,
		pollMs: 100,
		now: () => clock,
		sleep: async (ms: number) => {
			clock += ms;
		}
	};
}

beforeEach(() => rmSync(LOCK, { force: true }));
afterEach(() => rmSync(LOCK, { force: true }));

describe('the lock file', () => {
	it('is machine-wide, not inside a checkout', () => {
		// The override is what this spec runs against; the point is that the
		// default lives outside the repo so a sibling worktree can see it.
		delete process.env.CORVMC_UNIT_LOCK_FILE;
		const fallback = unitLockFile();
		process.env.CORVMC_UNIT_LOCK_FILE = LOCK;

		expect(fallback.startsWith(REPO_ROOT)).toBe(false);
		expect(fallback).toContain('corvmc-unit.lock');
	});
});

describe('acquiring', () => {
	it('takes a free lock and records who holds it', async () => {
		await expect(acquireUnitLock(immediate(0))).resolves.toBe('acquired');

		const held = readLock();
		expect(held.pid).toBe(process.pid);
		expect(held.root).toBe(REPO_ROOT);
	});

	it('waits rather than refusing when somebody else holds it', async () => {
		// Our own pid stands in for the sibling suite: it is the only one we can
		// be certain is alive, and `claim()` fails on the existing file whoever
		// owns it. The `root` is what proves the wait is for another checkout.
		writeLock({ pid: process.pid, root: '/another/worktree' });

		let announced: UnitLock | undefined;
		const result = await acquireUnitLock({
			...immediate(1_000),
			onWait: (holder) => {
				announced = holder;
			}
		});

		expect(result).toBe('timed-out');
		expect(announced?.root).toBe('/another/worktree');
	});

	it('announces the holder only once while it waits', async () => {
		writeLock({ pid: process.pid, root: '/another/worktree' });

		let calls = 0;
		await acquireUnitLock({ ...immediate(1_000), onWait: () => void calls++ });

		expect(calls).toBe(1);
	});

	it('runs anyway when the wait is exhausted, rather than failing the suite', async () => {
		writeLock({ pid: process.pid, root: '/another/worktree' });

		// The whole point of the timeout: slowness is acceptable, a red suite
		// because a colleague is testing is not.
		await expect(acquireUnitLock(immediate(500))).resolves.toBe('timed-out');
	});
});

describe('stale locks', () => {
	it('does not consider a live holder stale, however old', () => {
		const lock: UnitLock = {
			pid: process.pid,
			root: '/another/worktree',
			startedAt: 0
		};

		expect(isStale(lock, STALE_AFTER_MS * 100)).toBe(false);
	});

	it('respects a dead holder until the staleness window passes', () => {
		const lock: UnitLock = { pid: DEAD_PID, root: '/gone', startedAt: 0 };

		// Exactly on the boundary is still respected — a crashed run and a run
		// that is merely slow to start look identical here.
		expect(isStale(lock, STALE_AFTER_MS)).toBe(false);
		expect(isStale(lock, STALE_AFTER_MS + 1)).toBe(true);
	});

	it('takes over from a holder that died — the OOM-kill case', async () => {
		writeLock({ pid: DEAD_PID, startedAt: Date.now() - STALE_AFTER_MS - 1 });

		await expect(acquireUnitLock(immediate(0))).resolves.toBe('acquired');
		expect(readLock().pid).toBe(process.pid);
	});

	it('clears a lock file that is not a lock, rather than spinning on it forever', async () => {
		writeFileSync(LOCK, 'not json', 'utf8');

		// `claim()` keeps failing on the existing file while `read()` keeps
		// returning null, so this is the shape that used to busy-loop with no
		// deadline check and no sleep. One poll to rule out a torn read, then the
		// garbage goes and the run proceeds.
		await expect(acquireUnitLock(immediate(1_000))).resolves.toBe('acquired');
		expect(readLock().pid).toBe(process.pid);
	});

	it('gives a torn read one poll to heal before deleting anything', async () => {
		writeFileSync(LOCK, 'not json', 'utf8');

		// waitMs 0: the deadline is checked before a second look, so the first
		// pass must not have removed the file — a half-written record belonging
		// to a live holder has to survive.
		await expect(acquireUnitLock(immediate(0))).resolves.toBe('timed-out');
		expect(readFileSync(LOCK, 'utf8')).toBe('not json');
	});
});

describe('releasing', () => {
	it('removes a lock this process owns', async () => {
		await acquireUnitLock(immediate(0));
		releaseUnitLock();

		expect(existsSync(LOCK)).toBe(false);
	});

	it('leaves somebody else’s lock alone', () => {
		writeLock({ pid: DEAD_PID, root: '/another/worktree' });
		releaseUnitLock();

		expect(existsSync(LOCK)).toBe(true);
	});

	it('is safe to call twice', async () => {
		await acquireUnitLock(immediate(0));
		releaseUnitLock();

		expect(() => releaseUnitLock()).not.toThrow();
	});
});
