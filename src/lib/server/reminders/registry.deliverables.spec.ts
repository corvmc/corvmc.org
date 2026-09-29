import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A committee's show work (#1709): due in three days, then late by one to
 * fourteen. Pinned: the two bands do not overlap, the subject carries the due
 * date, and an item nobody can be told about is not stamped as sent.
 */

const listDeliverablesDueBetween = vi.fn(async (_from: Date, _to: Date) => [] as unknown[]);

vi.mock('$lib/server/volunteer/deliverables-service', () => ({ listDeliverablesDueBetween }));
vi.mock('$lib/server/inventory/loan-service', () => ({
	listLoansDueBetween: vi.fn(async () => [])
}));
vi.mock('$lib/server/volunteer/volunteer-signup-service', () => ({
	listSignupsStartingBetween: vi.fn(async () => []),
	listCompletionsAwaitingFeedback: vi.fn(async () => [])
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

const { reminders } = await import('./registry');

const NOW = new Date('2026-10-01T12:00:00Z');
const DAY = 86_400_000;
const byKey = (key: string) => reminders.find((r) => r.key === key)!;

const item = {
	id: 'wo-1',
	title: 'Poster art made',
	dueAt: new Date('2026-10-03T07:00:00Z'),
	eventTitle: 'Friday Night Fuzz',
	groupName: 'Art and Merchandise Committee',
	groupSlug: 'art-and-merchandise-committee',
	recipients: [{ userId: 'u1', userName: 'Ada', userEmail: 'ada@example.com' }]
};

beforeEach(() => vi.clearAllMocks());

describe('deliverable reminders', () => {
	it('registers a due-soon and an overdue stage', () => {
		const keys = reminders.filter((r) => r.event === 'volunteer.deliverable_due').map((r) => r.key);
		expect(keys).toEqual(['deliverable_due_3d', 'deliverable_overdue']);
	});

	it('asks for items due in the next three days, then for items one to fourteen days late', async () => {
		await byKey('deliverable_due_3d').due(NOW);
		await byKey('deliverable_overdue').due(NOW);
		expect(listDeliverablesDueBetween.mock.calls).toEqual([
			[NOW, new Date(NOW.getTime() + 3 * DAY)],
			[new Date(NOW.getTime() - 14 * DAY), new Date(NOW.getTime() - DAY)]
		]);
	});

	it('keys the subject by item and due date, and carries who to tell', async () => {
		listDeliverablesDueBetween.mockResolvedValueOnce([item]);
		expect(await byKey('deliverable_due_3d').due(NOW)).toEqual([
			{
				subjectId: `wo-1:${item.dueAt.toISOString()}`,
				payload: {
					stage: 'due_3d',
					workOrderId: 'wo-1',
					title: 'Poster art made',
					eventTitle: 'Friday Night Fuzz',
					dueAt: item.dueAt.toISOString(),
					groupName: 'Art and Merchandise Committee',
					groupSlug: 'art-and-merchandise-committee',
					recipients: item.recipients
				}
			}
		]);
	});

	it('owes nothing for an item with nobody to tell', async () => {
		listDeliverablesDueBetween.mockResolvedValueOnce([{ ...item, recipients: [] }]);
		expect(await byKey('deliverable_overdue').due(NOW)).toEqual([]);
	});
});
