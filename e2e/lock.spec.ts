/**
 * The lock's state machine, exercised against a scratch file.
 *
 * `CORVMC_E2E_LOCK_FILE` is set before anything is imported: touching the real
 * machine-wide path would delete the lock out from under whatever suite happened
 * to be running, which is exactly the failure the module exists to prevent.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireE2eLock, releaseE2eLock } from './lock';
import { REPO_ROOT } from './state-dir';

const SCRATCH = mkdtempSync(join(tmpdir(), 'corvmc-lock-spec-'));
const LOCK = join(SCRATCH, 'e2e.lock');

// `lock.ts` resolves the path on every call rather than capturing it at import,
// so setting this here — with plain static imports above — is enough. A dynamic
// `await import` to sequence it after the assignment would be the in-test import
// that costs a cold `.vite` cache its 5s budget.
process.env.CORVMC_E2E_LOCK_FILE = LOCK;

/** A pid that cannot be alive: the kernel rejects it before it looks anything up. */
const DEAD_PID = 2 ** 31 - 1;

function writeLock(lock: {
	pid: number;
	root: string;
	stage: 'prepare' | 'run';
	startedAt: number;
}) {
	writeFileSync(LOCK, JSON.stringify(lock), 'utf8');
}

beforeEach(() => rmSync(LOCK, { force: true }));
afterEach(() => rmSync(LOCK, { force: true }));

describe('acquiring', () => {
	it('takes a free lock and records this process', () => {
		acquireE2eLock('prepare');
		const held = JSON.parse(readFileSync(LOCK, 'utf8'));
		expect(held).toMatchObject({ pid: process.pid, root: REPO_ROOT, stage: 'prepare' });
	});

	it('refuses a live run in another checkout, naming it', () => {
		writeLock({
			pid: process.pid, // alive, and not this checkout
			root: '/Users/someone/Projects/corvmc-svelte/.claude/worktrees/other',
			stage: 'run',
			startedAt: Date.now()
		});
		expect(() => acquireE2eLock('prepare')).toThrow(/worktrees\/other/);
	});

	it('refuses a second run in this same checkout', () => {
		writeLock({ pid: process.pid, root: REPO_ROOT, stage: 'run', startedAt: Date.now() });
		expect(() => acquireE2eLock('prepare')).toThrow(/this checkout/);
	});

	it('steals a lock whose owner died and has aged out', () => {
		writeLock({
			pid: DEAD_PID,
			root: '/somewhere/else',
			stage: 'run',
			startedAt: Date.now() - 120_000
		});
		acquireE2eLock('prepare');
		expect(JSON.parse(readFileSync(LOCK, 'utf8')).pid).toBe(process.pid);
	});

	it('ignores a corrupt lock rather than wedging the suite', () => {
		writeFileSync(LOCK, 'not json', 'utf8');
		acquireE2eLock('prepare');
		expect(JSON.parse(readFileSync(LOCK, 'utf8')).pid).toBe(process.pid);
	});
});

describe('the prepare → run handoff', () => {
	/**
	 * `pnpm test:e2e` is two processes. `prepare.ts` exits once it has seeded, so
	 * by the time `run.ts` starts the lock it must adopt has a *dead* pid and a
	 * timestamp seconds old — indistinguishable, by pid alone, from a crash.
	 */
	it('lets run adopt the lock prepare left behind', () => {
		writeLock({ pid: DEAD_PID, root: REPO_ROOT, stage: 'prepare', startedAt: Date.now() });
		acquireE2eLock('run');
		expect(JSON.parse(readFileSync(LOCK, 'utf8'))).toMatchObject({
			pid: process.pid,
			stage: 'run'
		});
	});

	it('does not let a foreign checkout adopt it', () => {
		writeLock({ pid: DEAD_PID, root: '/somewhere/else', stage: 'prepare', startedAt: Date.now() });
		expect(() => acquireE2eLock('run')).toThrow(/somewhere\/else/);
	});

	it('does not let a second prepare adopt it', () => {
		writeLock({ pid: DEAD_PID, root: REPO_ROOT, stage: 'prepare', startedAt: Date.now() });
		expect(() => acquireE2eLock('prepare')).toThrow(/Another e2e run/);
	});
});

describe('releasing', () => {
	it('drops a lock this process owns', () => {
		acquireE2eLock('run');
		releaseE2eLock();
		expect(() => readFileSync(LOCK, 'utf8')).toThrow();
	});

	it('leaves somebody else’s lock alone', () => {
		const foreign = {
			pid: process.pid,
			root: '/somewhere/else',
			stage: 'run' as const,
			startedAt: Date.now()
		};
		// Same pid, but `releaseE2eLock` compares pids — so make it differ.
		writeLock({ ...foreign, pid: DEAD_PID });
		releaseE2eLock();
		expect(JSON.parse(readFileSync(LOCK, 'utf8')).pid).toBe(DEAD_PID);
	});

	it('is safe to call twice', () => {
		acquireE2eLock('run');
		releaseE2eLock();
		expect(() => releaseE2eLock()).not.toThrow();
	});
});
