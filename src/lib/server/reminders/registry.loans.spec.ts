import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The loan nags: one courtesy and three overdue stages against one anchor.
 *
 * What is worth pinning is the windows, because a wrong bound is invisible
 * until somebody is nagged on the wrong day — or never.
 */

const listLoansDueBetween = vi.fn(async (_from: Date, _to: Date) => [] as unknown[]);

vi.mock('$lib/server/inventory/loan-service', () => ({ listLoansDueBetween }));
vi.mock('$lib/server/volunteer/volunteer-signup-service', () => ({
	listSignupsStartingBetween: vi.fn(async () => []),
	listCompletionsAwaitingFeedback: vi.fn(async () => [])
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

const { reminders } = await import('./registry');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-15T12:00:00Z');

const byKey = (key: string) => reminders.find((r) => r.key === key)!;

const row = {
	loanId: 'loan-1',
	userId: 'u-1',
	userName: 'Robin',
	userEmail: 'robin@example.com',
	equipmentName: 'SM58',
	dueDate: new Date('2026-06-16T12:00:00Z')
};

beforeEach(() => {
	vi.clearAllMocks();
	listLoansDueBetween.mockResolvedValue([]);
});

describe('loan reminders', () => {
	it('registers the courtesy and three overdue stages, each with its own key', () => {
		const keys = reminders.filter((r) => r.subjectType === 'inventory_loan').map((r) => r.key);
		expect(keys).toEqual([
			'loan_due_tomorrow',
			'loan_overdue_1d',
			'loan_overdue_3d',
			'loan_overdue_7d'
		]);
	});

	it('asks for loans due in the next day, and says nobody is late', async () => {
		listLoansDueBetween.mockResolvedValue([row]);

		const due = await byKey('loan_due_tomorrow').due(NOW);

		expect(listLoansDueBetween).toHaveBeenCalledWith(NOW, new Date(NOW.getTime() + DAY));
		expect(due).toHaveLength(1);
		expect(due[0].subjectId).toBe('loan-1');
		expect(due[0].payload).toMatchObject({ stage: 'due_tomorrow', daysLate: 0, loanId: 'loan-1' });
	});

	// Bands, not "anything older than N": a loan already fifteen days late would
	// otherwise take all three stages in one drain.
	it.each([
		[1, 3],
		[3, 7],
		[7, 30]
	])('asks for loans %s to %s days past due', async (days, until) => {
		listLoansDueBetween.mockResolvedValue([row]);

		const due = await byKey(`loan_overdue_${days}d`).due(NOW);

		expect(listLoansDueBetween).toHaveBeenCalledWith(
			new Date(NOW.getTime() - until * DAY),
			new Date(NOW.getTime() - days * DAY)
		);
		expect(due[0].payload).toMatchObject({ stage: 'overdue', daysLate: days });
	});

	it('never looks further back than thirty days, at any stage', async () => {
		// The floor. Turning these on must not nag about every loan ever lost.
		const floor = new Date(NOW.getTime() - 30 * DAY);
		for (const r of reminders.filter((x) => x.subjectType === 'inventory_loan')) {
			await r.due(NOW);
		}
		for (const [from] of listLoansDueBetween.mock.calls) {
			expect(from.getTime()).toBeGreaterThanOrEqual(floor.getTime());
		}
	});

	it('emits the same event for every stage, so one preference silences all four', () => {
		const events = reminders.filter((r) => r.subjectType === 'inventory_loan').map((r) => r.event);
		expect(new Set(events)).toEqual(new Set(['equipment.loan_due']));
	});
});
