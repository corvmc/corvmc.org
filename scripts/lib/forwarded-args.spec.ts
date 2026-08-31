import { describe, it, expect } from 'vitest';
import { forwardedArgs } from './forwarded-args';

/**
 * `scripts/run-unit-tests.ts` and `e2e/run.ts` both spawn a child process at
 * import time, so neither can be imported by a test. The one thing worth
 * guarding is the argument handling, and this is where it lives — the
 * documented spelling of every gate in `CLAUDE.md` goes through it.
 */
describe('forwardedArgs', () => {
	it('drops the separator pnpm forwards, so `-- --run` still means --run', () => {
		expect(forwardedArgs(['--', '--run'])).toEqual(['--run']);
	});

	it('keeps flags and paths in order', () => {
		expect(forwardedArgs(['--', '--run', '--project=server', 'src/lib/server/'])).toEqual([
			'--run',
			'--project=server',
			'src/lib/server/'
		]);
	});

	it('leaves an invocation without the separator alone', () => {
		expect(forwardedArgs(['--run', '--project=server'])).toEqual(['--run', '--project=server']);
	});

	it('drops nothing that merely starts with the separator', () => {
		expect(forwardedArgs(['--reporter=dot', '---'])).toEqual(['--reporter=dot', '---']);
	});
});
