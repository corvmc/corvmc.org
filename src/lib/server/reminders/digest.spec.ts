import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The class: a reminder whose one recipient can be owed many subjects in one
 * pass. Sent per subject, four show items read as four duplicate mails (#2507).
 * Pinned through the real registry entries and the real drain, so a stage
 * added without the digest, or a drain that stops grouping, fails here.
 */

const listDeliverablesDueBetween = vi.fn(async (_from: Date, _to: Date) => [] as unknown[]);
vi.mock('#lib/server/volunteer/deliverables-service.js', () => ({ listDeliverablesDueBetween }));
vi.mock('#lib/server/inventory/loan-service.js', () => ({
	listLoansDueBetween: vi.fn(async () => [])
}));
vi.mock('#lib/server/volunteer/volunteer-signup-service.js', () => ({
	listSignupsStartingBetween: vi.fn(async () => []),
	listCompletionsAwaitingFeedback: vi.fn(async () => [])
}));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const emit = vi.fn(async (_event: string, _payload: unknown) => undefined);
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit, on: vi.fn() } }));

let marks: { subjectId: string }[] = [];
const insertValues = vi.fn(async (_values: unknown) => undefined);
vi.mock('#lib/server/db/index.js', () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => marks }) }),
		insert: () => ({ values: (v: unknown) => insertValues(v) })
	}
}));

const { reminders } = await import('./registry');
const { drainReminders } = await import('./drain');

const NOW = new Date('2026-10-26T18:30:00Z');
const ada = { userId: 'u1', userName: 'Ada', userEmail: 'ada@example.com' };
const bo = { userId: 'u2', userName: 'Bo', userEmail: 'bo@example.com' };

const item = (id: string, dueAt: string, recipients = [ada]) => ({
	id,
	title: 'Settlement recorded',
	dueAt: new Date(dueAt),
	eventTitle: `Show ${id}`,
	groupName: 'Booking Committee',
	groupSlug: 'booking-committee',
	recipients
});

const deliverables = reminders.filter((r) => r.event === 'volunteer.deliverable_due');
const sends = () => emit.mock.calls.filter(([event]) => event === 'volunteer.deliverable_due');

beforeEach(() => {
	vi.clearAllMocks();
	emit.mockImplementation(async () => undefined);
	marks = [];
	// Two items due soon, two late: one person, both stages, one pass.
	listDeliverablesDueBetween
		.mockResolvedValueOnce([
			item('wo-1', '2026-10-27T03:00:00Z'),
			item('wo-2', '2026-10-28T03:00:00Z')
		])
		.mockResolvedValueOnce([
			item('wo-3', '2026-10-20T03:00:00Z'),
			item('wo-4', '2026-10-21T03:00:00Z')
		]);
});

describe('deliverable reminders, one recipient owed several items (#2507)', () => {
	it('sends that person one message for all four', async () => {
		const result = await drainReminders(NOW, deliverables);

		expect(sends()).toHaveLength(1);
		expect(result).toMatchObject({ due: 4, sent: 4, failed: 0 });
	});

	it('lists every item in that one message and stamps each under its own stage', async () => {
		await drainReminders(NOW, deliverables);

		const [[, digest]] = sends() as [
			string,
			{ recipient: unknown; items: { workOrderId: string }[] }
		][];
		expect(digest.recipient).toEqual(ada);
		expect(digest.items.map((i) => i.workOrderId)).toEqual(['wo-1', 'wo-2', 'wo-3', 'wo-4']);
		expect(insertValues.mock.calls.map(([v]) => v)).toEqual([
			expect.objectContaining({
				reminderKey: 'deliverable_due_3d',
				subjectId: 'wo-1:2026-10-27T03:00:00.000Z'
			}),
			expect.objectContaining({
				reminderKey: 'deliverable_due_3d',
				subjectId: 'wo-2:2026-10-28T03:00:00.000Z'
			}),
			expect.objectContaining({
				reminderKey: 'deliverable_overdue',
				subjectId: 'wo-3:2026-10-20T03:00:00.000Z'
			}),
			expect.objectContaining({
				reminderKey: 'deliverable_overdue',
				subjectId: 'wo-4:2026-10-21T03:00:00.000Z'
			})
		]);
	});

	it('leaves out what is already stamped, and sends nothing when that is everything', async () => {
		marks = [
			'wo-1:2026-10-27T03:00:00.000Z',
			'wo-2:2026-10-28T03:00:00.000Z',
			'wo-3:2026-10-20T03:00:00.000Z',
			'wo-4:2026-10-21T03:00:00.000Z'
		].map((subjectId) => ({ subjectId }));

		const result = await drainReminders(NOW, deliverables);

		expect(sends()).toHaveLength(0);
		expect(result).toMatchObject({ due: 4, sent: 0, alreadySent: 4 });
	});
});

describe('a digest whose send fails for one recipient', () => {
	beforeEach(() => {
		listDeliverablesDueBetween.mockReset();
		listDeliverablesDueBetween
			.mockResolvedValueOnce([
				item('wo-1', '2026-10-27T03:00:00Z', [ada, bo]),
				item('wo-2', '2026-10-28T03:00:00Z', [bo])
			])
			.mockResolvedValueOnce([item('wo-3', '2026-10-20T03:00:00Z', [ada])]);
		emit.mockImplementation(async (_event, payload) => {
			if ((payload as { recipient: { userId: string } }).recipient.userId === 'u2') {
				throw new Error('down');
			}
		});
	});

	it('still sends the others, and stamps only items every recipient was sent', async () => {
		const result = await drainReminders(NOW, deliverables);

		expect(sends()).toHaveLength(2);
		expect(insertValues.mock.calls.map(([v]) => (v as { subjectId: string }).subjectId)).toEqual([
			'wo-3:2026-10-20T03:00:00.000Z'
		]);
		expect(result).toMatchObject({ due: 3, sent: 1, failed: 2 });
	});
});
