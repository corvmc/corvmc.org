import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReminderDefinition } from './types';

/**
 * What makes a reminder fire once.
 *
 * Before #1186 that was the cadence of a daily cron, argued separately in each
 * of four endpoints — and #1123 was one of those arguments being wrong. Here it
 * is a row, so the drain can run every fifteen minutes.
 */

const emit = vi.fn(async () => undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit, on: vi.fn() } }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

let marks: { subjectId: string }[] = [];
const insertValues = vi.fn(async () => undefined);
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => marks }) }),
		insert: () => ({ values: (v: unknown) => insertValues(v as never) })
	}
}));

// The registry is the production list; these tests drive their own.
vi.mock('./registry', () => ({ reminders: [] }));

const { drainReminders } = await import('./drain');

const definition = (over: Partial<ReminderDefinition> = {}): ReminderDefinition =>
	({
		key: 'test_reminder',
		subjectType: 'reservation',
		event: 'reservation.reminder_due',
		due: async () => [{ subjectId: 'res-1', payload: { reservationId: 'res-1' } }],
		...over
	}) as ReminderDefinition;

beforeEach(() => {
	vi.clearAllMocks();
	marks = [];
});

describe('draining what is owed', () => {
	it('emits the definition’s event for a subject with no mark', async () => {
		const result = await drainReminders(new Date(), [definition()]);

		expect(emit).toHaveBeenCalledWith('reservation.reminder_due', { reservationId: 'res-1' });
		expect(result).toMatchObject({ due: 1, sent: 1, alreadySent: 0, failed: 0 });
	});

	it('writes the mark after the emit, not before', async () => {
		await drainReminders(new Date(), [definition()]);

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ reminderKey: 'test_reminder', subjectId: 'res-1' })
		);
		expect(emit.mock.invocationCallOrder[0]).toBeLessThan(insertValues.mock.invocationCallOrder[0]);
	});

	it('says nothing twice for one subject', async () => {
		marks = [{ subjectId: 'res-1' }];

		const result = await drainReminders(new Date(), [definition()]);

		expect(emit).not.toHaveBeenCalled();
		expect(result).toMatchObject({ sent: 0, alreadySent: 1 });
	});

	it('does not ask the database when nothing is due', async () => {
		const result = await drainReminders(new Date(), [definition({ due: async () => [] })]);

		expect(insertValues).not.toHaveBeenCalled();
		expect(result).toMatchObject({ due: 0, sent: 0 });
	});
});

describe('what one broken definition costs', () => {
	it('leaves no mark when the emit throws, so the next pass retries', async () => {
		// The order the mark is written in is the whole reason: a reminder nobody
		// got must not be recorded as sent.
		emit.mockRejectedValueOnce(new Error('listener exploded'));

		const result = await drainReminders(new Date(), [definition()]);

		expect(insertValues).not.toHaveBeenCalled();
		expect(result).toMatchObject({ sent: 0, failed: 1 });
	});

	it('runs the rest when one definition’s query throws', async () => {
		const broken = definition({
			key: 'broken',
			due: async () => {
				throw new Error('bad query');
			}
		});

		const result = await drainReminders(new Date(), [broken, definition()]);

		expect(emit).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ sent: 1, failed: 1 });
	});
});
