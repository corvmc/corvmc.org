import { describe, it, expect } from 'vitest';
import { threadDisplayStatus, openReason, waitingSince, waitingDays } from './thread-status';

const day = 86_400_000;
const at = (iso: string) => new Date(iso);

describe('threadDisplayStatus', () => {
	it('reports awaiting_reply for an open thread carrying the marker', () => {
		expect(threadDisplayStatus({ status: 'open', awaitingReplySince: at('2026-09-01') })).toBe(
			'awaiting_reply'
		);
	});

	// The marker is orthogonal to status and nothing guarantees a resolved row
	// has had it cleared, so status has to win.
	it('leaves every other status alone even with the marker set', () => {
		expect(threadDisplayStatus({ status: 'resolved', awaitingReplySince: at('2026-09-01') })).toBe(
			'resolved'
		);
		expect(threadDisplayStatus({ status: 'open', awaitingReplySince: null })).toBe('open');
	});
});

describe('openReason', () => {
	const base = { status: 'open', awaitingReplySince: null, createdAt: at('2026-08-01') };

	it('is unanswered when nobody here has ever replied', () => {
		expect(openReason({ ...base, lastOutboundAt: null })).toBe('unanswered');
	});

	it('is replied once an outbound message exists', () => {
		expect(openReason({ ...base, lastOutboundAt: at('2026-08-20') })).toBe('replied');
	});

	// `wakeSnoozedThreads` flips the status and leaves the date behind, which is
	// the only trace that the thread returned on its own rather than being
	// answered or reopened by hand.
	it('is snooze_expired for an open thread with an elapsed snooze and nothing since', () => {
		expect(
			openReason({
				...base,
				snoozedUntil: at('2026-08-25'),
				lastMessageAt: at('2026-08-20'),
				lastOutboundAt: at('2026-08-20')
			})
		).toBe('snooze_expired');
	});

	// A message after the snooze elapsed is the newer story; saying "snooze
	// expired" about a thread someone has since written to is stale.
	it('falls back to the message reason once something arrives after the snooze', () => {
		expect(
			openReason({
				...base,
				snoozedUntil: at('2026-08-25'),
				lastMessageAt: at('2026-08-27'),
				lastOutboundAt: at('2026-08-20')
			})
		).toBe('replied');
	});

	// Only the Open view asks this question. Everything else is already in a
	// view that explains itself.
	it('is null for anything that is not open and waiting on us', () => {
		expect(openReason({ ...base, status: 'snoozed', lastOutboundAt: null })).toBeNull();
		expect(openReason({ ...base, status: 'resolved', lastOutboundAt: null })).toBeNull();
		expect(
			openReason({
				...base,
				awaitingReplySince: at('2026-08-28'),
				lastOutboundAt: at('2026-08-28')
			})
		).toBeNull();
	});
});

describe('waitingSince', () => {
	// Mirrors the COALESCE in thread-service's `waitingSince` fragment, which is
	// what actually orders the list. If these two disagree the chip contradicts
	// the sort.
	it('prefers the awaiting marker, then the last message, then creation', () => {
		expect(
			waitingSince({
				status: 'open',
				awaitingReplySince: at('2026-08-28'),
				lastMessageAt: at('2026-08-20'),
				createdAt: at('2026-08-01')
			})
		).toEqual(at('2026-08-28'));

		expect(
			waitingSince({
				status: 'open',
				awaitingReplySince: null,
				lastMessageAt: at('2026-08-20'),
				createdAt: at('2026-08-01')
			})
		).toEqual(at('2026-08-20'));

		expect(
			waitingSince({ status: 'open', awaitingReplySince: null, createdAt: at('2026-08-01') })
		).toEqual(at('2026-08-01'));
	});
});

describe('waitingDays', () => {
	const now = at('2026-09-01T12:00:00Z');

	it('floors to whole days', () => {
		const thread = {
			status: 'open',
			awaitingReplySince: null,
			createdAt: new Date(now.getTime() - 6.9 * day)
		};
		expect(waitingDays(thread, now)).toBe(6);
	});

	// A thread created an hour ago has waited zero days, not a negative number
	// and not one.
	it('reports zero for something that arrived today', () => {
		const thread = {
			status: 'open',
			awaitingReplySince: null,
			createdAt: new Date(now.getTime() - 3_600_000)
		};
		expect(waitingDays(thread, now)).toBe(0);
	});
});
