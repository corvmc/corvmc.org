import { describe, it, expect } from 'vitest';
import { classifyRun, selectRun } from './queue-guard-run.mjs';

const run = (id: number, pr: number, conclusion: string) => ({
	databaseId: id,
	headBranch: `gh-readonly-queue/main/pr-${pr}-abc123`,
	conclusion
});

describe('selectRun', () => {
	it('finds a run with no conclusion yet: the rejection of #2448', () => {
		expect(selectRun([run(42092132332, 2448, '')], 2448)?.databaseId).toBe(42092132332);
	});

	it('takes the newest run of the PR, not an older failed one', () => {
		const runs = [run(3, 7, ''), run(2, 7, 'failure')];
		expect(selectRun(runs, 7)?.databaseId).toBe(3);
	});

	it('does not match a PR whose number starts the same', () => {
		expect(selectRun([run(1, 24, 'failure')], 2)).toBeUndefined();
	});
});

describe('classifyRun', () => {
	it('reads a failed job in an unfinished run as a failure', () => {
		expect(classifyRun({ conclusion: '', failed: 'E2E', timedout: '' })).toBe('failed');
	});

	it('does not rule on an unfinished run with no failed job', () => {
		expect(classifyRun({ conclusion: '', failed: '', timedout: '' })).toBe('no-failure');
	});

	it('reads a job past its own limit as a timeout', () => {
		expect(classifyRun({ conclusion: 'cancelled', failed: '', timedout: 'E2E (30m0s)' })).toBe(
			'timeout'
		);
	});

	it('reads a cancelled run with nothing else as superseded', () => {
		expect(classifyRun({ conclusion: 'cancelled', failed: '', timedout: '' })).toBe('superseded');
	});

	it('reads a failed run whose jobs all passed as the run itself failing', () => {
		expect(classifyRun({ conclusion: 'failure', failed: '', timedout: '' })).toBe('run-failed');
	});
});
