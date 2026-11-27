import { describe, it, expect } from 'vitest';
import { doorCheck, oneCounter } from './door-check';

describe('doorCheck', () => {
	it.each([
		[null, null, 'none'],
		[500_00, null, 'single'],
		[null, 500_00, 'single'],
		[500_00, 500_00, 'agreed'],
		[0, 0, 'agreed'],
		[500_00, 480_00, 'mismatch']
	] as const)('handoffs %s against staff %s is %s', (handoffs, staff, expected) => {
		expect(doorCheck(handoffs, staff)).toBe(expected);
	});
});

// The refuse-versus-warn class (#2722, reversed in #3273): this is a flag the
// callers warn on, and the pure function has no way to throw.
describe('oneCounter', () => {
	it.each([
		['the staff counter made every handoff', ['ana', 'ana'], 'ana', true],
		['a handoff by somebody else', ['ana', 'ben'], 'ana', false],
		['no staff count', ['ana'], null, false],
		['no handoffs, which "single" already warns about', [], 'ana', false],
		['a handoff whose counter was deleted', ['ana', null], 'ana', false]
	] as const)('%s', (_, handoffs, staff, expected) => {
		expect(oneCounter(handoffs, staff)).toBe(expected);
	});
});
