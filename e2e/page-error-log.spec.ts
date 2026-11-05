import { describe, expect, it } from 'vitest';
import { formatPageErrors, type PageErrorEntry } from './page-error-log';

const uncaught: PageErrorEntry = { kind: 'pageerror', url: '/a', text: 'TypeError: x\n  at f' };
const logged: PageErrorEntry = { kind: 'console.error', url: '/b', text: 'status of 403' };
const failed = { title: 'a test', retry: 0, failed: true };
const passed = { ...failed, failed: false };

describe('formatPageErrors', () => {
	it('names the attempt and keeps every line of the stack', () => {
		const report = formatPageErrors([uncaught], failed);
		expect(report).toContain('attempt 0, failed');
		expect(report).toContain('TypeError: x');
		expect(report).toContain('at f');
	});

	it('reports console errors for a failed attempt', () => {
		expect(formatPageErrors([logged], failed)).toContain('status of 403');
	});

	it('leaves console errors out of a passing attempt, but not exceptions', () => {
		expect(formatPageErrors([logged], passed)).toBeUndefined();
		const report = formatPageErrors([uncaught, logged], passed);
		expect(report).toContain('TypeError: x');
		expect(report).not.toContain('status of 403');
	});

	it('says nothing when nothing went wrong', () => {
		expect(formatPageErrors([], failed)).toBeUndefined();
	});

	it('caps the report and counts what it dropped', () => {
		const entries = Array.from({ length: 45 }, () => logged);
		const report = formatPageErrors(entries, failed);
		expect(report?.match(/status of 403/g)).toHaveLength(40);
		expect(report).toContain('and 5 more');
	});
});
