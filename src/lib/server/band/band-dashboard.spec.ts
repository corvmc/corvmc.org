import { describe, it, expect } from 'vitest';
import { bandSetupSteps, bandTodos, bandUpcoming, type TodoInput } from './band-dashboard';

const at = (iso: string) => new Date(iso);
const none: TodoInput = {
	slug: 'saltmarsh',
	unpaid: [],
	unreadEnquiries: 0,
	invitees: [],
	drafts: []
};

describe('bandTodos', () => {
	it('is empty when the band owes and has to answer nothing', () => {
		expect(bandTodos(none)).toEqual([]);
	});

	it('offers to pay each unpaid reservation, with the amount when it is known', () => {
		const items = bandTodos({
			...none,
			unpaid: [
				{ id: 'r1', startsAt: at('2026-11-20T18:00:00Z'), cashDueCents: 3000 },
				{ id: 'r2', startsAt: at('2026-11-22T18:00:00Z'), cashDueCents: null }
			]
		});
		expect(items.map((i) => [i.kind, i.href])).toEqual([
			['reservation-unpaid', '/member/reservations/r1/pay'],
			['reservation-unpaid', '/member/reservations/r2/pay']
		]);
		expect(items[0].detail).toContain('$30.00');
		expect(items[1].detail).not.toContain('$');
	});

	it('names every invitee rather than counting them', () => {
		const [item] = bandTodos({ ...none, invitees: ['Ada', 'sam@example.com'] });
		expect(item.kind).toBe('invites-pending');
		expect(item.detail).toBe('Ada, sam@example.com');
		expect(item.href).toBe('/band/saltmarsh/members');
	});

	it('sends unread enquiries to the band inbox', () => {
		const [item] = bandTodos({ ...none, unreadEnquiries: 2 });
		expect(item.kind).toBe('enquiries-unread');
		expect(item.href).toBe('/band/saltmarsh/messages');
	});

	it('puts dated rows first, soonest first, then the undated ones', () => {
		const items = bandTodos({
			slug: 'saltmarsh',
			unpaid: [{ id: 'r1', startsAt: at('2026-12-01T18:00:00Z'), cashDueCents: 3000 }],
			unreadEnquiries: 1,
			invitees: ['Ada'],
			drafts: [{ id: 'e1', title: 'House show', startsAt: at('2026-11-25T03:00:00Z') }]
		});
		expect(items.map((i) => i.kind)).toEqual([
			'event-draft',
			'reservation-unpaid',
			'enquiries-unread',
			'invites-pending'
		]);
	});
});

describe('bandUpcoming', () => {
	it('interleaves reservations and events by start, up to the limit', () => {
		const rows = bandUpcoming(
			'saltmarsh',
			[
				{
					id: 'r1',
					startsAt: at('2026-11-20T18:00:00Z'),
					endsAt: at('2026-11-20T20:00:00Z'),
					status: 'confirmed'
				},
				{
					id: 'r2',
					startsAt: at('2026-12-02T18:00:00Z'),
					endsAt: at('2026-12-02T20:00:00Z'),
					status: 'confirmed'
				}
			],
			[
				{
					id: 'e1',
					title: 'House show',
					startsAt: at('2026-11-25T03:00:00Z'),
					endsAt: null,
					status: 'published'
				}
			],
			2
		);
		expect(rows.map((r) => [r.kind, r.href])).toEqual([
			['reservation', '/band/saltmarsh/reservations/r1'],
			['event', '/band/saltmarsh/events/e1']
		]);
	});
});

describe('bandSetupSteps', () => {
	const fresh = {
		slug: 'porchlights',
		memberCount: 1,
		invitesPending: 0,
		hasReservation: false,
		hasProfile: false,
		hasEvent: false
	};
	const done = (input: typeof fresh) =>
		bandSetupSteps(input)
			.filter((s) => s.done)
			.map((s) => s.key);

	it('leaves every step open for a band with only a name', () => {
		expect(done(fresh)).toEqual([]);
	});

	it('ticks inviting once someone has been asked, before they answer', () => {
		expect(done({ ...fresh, invitesPending: 1 })).toEqual(['invite']);
		expect(done({ ...fresh, memberCount: 2 })).toEqual(['invite']);
	});

	it('ticks each step from its own fact', () => {
		expect(done({ ...fresh, hasReservation: true, hasProfile: true, hasEvent: true })).toEqual([
			'reserve',
			'profile',
			'event'
		]);
	});
});
