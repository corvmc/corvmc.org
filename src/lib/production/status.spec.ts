import { describe, it, expect } from 'vitest';
import { isTerminalProduction, transitionWarnings } from './status';

describe('transitionWarnings', () => {
	it('is silent on every button of the usual path', () => {
		const usual = [
			['draft', 'offered'],
			['draft', 'confirmed'],
			['offered', 'confirmed'],
			['offered', 'draft'],
			['confirmed', 'completed'],
			['completed', 'settled'],
			['settled', 'closed'],
			['draft', 'cancelled'],
			['confirmed', 'cancelled']
		] as const;
		for (const [from, to] of usual)
			expect(transitionWarnings(from, to), `${from}→${to}`).toEqual([]);
	});

	it('names the steps a move skips', () => {
		expect(transitionWarnings('draft', 'settled')).toEqual(['Skips confirmed, completed.']);
	});

	it('flags a move back, and the ledger reversal below settled', () => {
		expect(transitionWarnings('settled', 'confirmed')).toEqual([
			'Moves back from settled to confirmed.',
			'The costs posted at settlement are reversed in the ledger.'
		]);
	});

	it('flags cancelling a night that already happened', () => {
		expect(transitionWarnings('completed', 'cancelled')).toHaveLength(1);
	});

	it('names open load-out tasks on a close, five at most', () => {
		const open = Array.from({ length: 7 }, (_, i) => `Task ${i + 1}`);
		expect(transitionWarnings('settled', 'closed', { outstandingCloseOut: open })).toEqual([
			'Load-out is not finished: Task 1, Task 2, Task 3, Task 4, Task 5 and 2 more.'
		]);
	});
});

describe('isTerminalProduction', () => {
	it('is closed and cancelled, and nothing else', () => {
		expect(isTerminalProduction('closed')).toBe(true);
		expect(isTerminalProduction('cancelled')).toBe(true);
		expect(isTerminalProduction('settled')).toBe(false);
	});
});
