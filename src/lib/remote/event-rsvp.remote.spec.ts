import { describe, it, expect, vi, beforeEach } from 'vitest';

// The interstitial answers every visitor and must never 500 on a closed event;
// the writes refuse a signed-out caller and an event that takes no RSVP.

const HOUR = 3600_000;
let currentUser: { id: string; name: string; email: string } | null = null;
let evt: Record<string, unknown> | null = null;
let mine: unknown = null;

vi.mock('$lib/server/authorization', () => ({
	requireUser: () => {
		if (!currentUser) throw new Error('401: Not authenticated');
		return currentUser;
	}
}));
vi.mock('@sveltejs/kit', () => ({
	error: (status: number, message: string) => {
		throw new Error(`${status}: ${message}`);
	}
}));
vi.mock('$lib/server/event/event-service', () => ({ getById: vi.fn(async () => evt) }));
const svc = {
	createRsvp: vi.fn(async () => undefined),
	cancelRsvp: vi.fn(async () => undefined),
	getUserRsvp: vi.fn(async () => mine),
	listRsvpsForEvent: vi.fn(async () => [] as unknown[])
};
vi.mock('$lib/server/event/rsvp-service', () => svc);

const refresh = vi.fn();
const refreshPublic = vi.fn();
vi.mock('$lib/remote/events.remote', () => ({
	getPublicEventDetail: () => ({ refresh: refreshPublic })
}));
const roster = { requireListingWriter: vi.fn(async (): Promise<unknown> => ({ id: 'staff-1' })) };
vi.mock('$lib/server/event/listing-guard', () => ({
	requireListingWriter: (...a: unknown[]) => roster.requireListingWriter(...(a as []))
}));
vi.mock('$lib/server/entity/refs', () => ({
	toMemberRef: (r: { id: string; name: string; email: string }) => ({
		type: 'member',
		id: r.id,
		title: r.name,
		subtitle: r.email
	})
}));
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: currentUser } }),
	query: (_schema: unknown, handler: (a: unknown) => Promise<unknown>) =>
		Object.assign((a: unknown) => Object.assign(handler(a), { refresh }), {
			__: { type: 'query' }
		}),
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) =>
		Object.assign(handler, { __: { type: 'form' } })
}));

const remote = await import('./event-rsvp.remote');
const getRsvpStatus = remote.getRsvpStatus as unknown as (
	id: string
) => Promise<Awaited<ReturnType<typeof remote.getRsvpStatus>>>;
const confirmRsvp = remote.confirmRsvp as unknown as (d: unknown) => Promise<unknown>;
const withdrawRsvp = remote.withdrawRsvp as unknown as (d: unknown) => Promise<unknown>;

const ADA = { id: 'u-ada', name: 'Ada', email: 'ada@example.com' };

function event(over: Record<string, unknown> = {}) {
	return {
		id: 'e1',
		title: 'Mixing Workshop',
		startsAt: new Date(Date.now() + 48 * HOUR),
		endsAt: new Date(Date.now() + 50 * HOUR),
		location: 'CMC',
		posterKey: 'p.jpg',
		status: 'published',
		ticketingEnabled: false,
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = null;
	evt = event();
	mine = null;
});

describe('getRsvpStatus', () => {
	it('404s an unknown event', async () => {
		evt = null;
		await expect(getRsvpStatus('nope')).rejects.toThrow('404');
	});

	it('answers a signed-out visitor with a state, not a 401', async () => {
		const r = await getRsvpStatus('e1');
		expect(r.state).toBe('signed-out');
		expect(r.attendee).toBeNull();
	});

	it('offers a signed-in member the one-tap RSVP, with what it will record', async () => {
		currentUser = ADA;
		const r = await getRsvpStatus('e1');
		expect(r.state).toBe('open');
		expect(r.attendee).toEqual({ name: 'Ada', email: 'ada@example.com' });
	});

	it("says you're going once you are", async () => {
		currentUser = ADA;
		mine = { id: 'r1' };
		expect((await getRsvpStatus('e1')).state).toBe('going');
	});

	it.each([
		['cancelled', { status: 'cancelled' }],
		['ticketed', { ticketingEnabled: true }],
		[
			'past',
			{ startsAt: new Date(Date.now() - 50 * HOUR), endsAt: new Date(Date.now() - 48 * HOUR) }
		]
	])('closes a %s event with its reason, not an error', async (reason, over) => {
		currentUser = ADA;
		evt = event(over);
		const r = await getRsvpStatus('e1');
		expect(r).toMatchObject({ state: 'closed', reason });
	});

	it('closes an unpublished event', async () => {
		evt = event({ status: 'draft' });
		expect(await getRsvpStatus('e1')).toMatchObject({ state: 'closed', reason: 'unpublished' });
	});
});

describe('confirmRsvp', () => {
	it('refuses a signed-out caller before touching the event', async () => {
		await expect(confirmRsvp({ eventId: 'e1' })).rejects.toThrow('401');
		expect(svc.createRsvp).not.toHaveBeenCalled();
	});

	it("records the member's own name and email", async () => {
		currentUser = ADA;
		await confirmRsvp({ eventId: 'e1' });
		expect(svc.createRsvp).toHaveBeenCalledWith({
			eventId: 'e1',
			userId: 'u-ada',
			attendeeName: 'Ada',
			attendeeEmail: 'ada@example.com'
		});
		expect(refresh).toHaveBeenCalled();
		expect(refreshPublic).toHaveBeenCalled();
	});

	it.each([{ status: 'cancelled' }, { status: 'draft' }, { ticketingEnabled: true }])(
		'refuses an event that takes no RSVP (%o)',
		async (over) => {
			currentUser = ADA;
			evt = event(over);
			await expect(confirmRsvp({ eventId: 'e1' })).rejects.toThrow('409');
			expect(svc.createRsvp).not.toHaveBeenCalled();
		}
	);
});

describe('withdrawRsvp', () => {
	it('refuses a signed-out caller', async () => {
		await expect(withdrawRsvp({ eventId: 'e1' })).rejects.toThrow('401');
		expect(svc.cancelRsvp).not.toHaveBeenCalled();
	});

	it("cancels only the caller's own RSVP", async () => {
		currentUser = ADA;
		await withdrawRsvp({ eventId: 'e1' });
		expect(svc.cancelRsvp).toHaveBeenCalledWith('e1', 'u-ada');
	});
});

describe('getEventRsvpRoster', () => {
	const getEventRsvpRoster = remote.getEventRsvpRoster as unknown as (
		id: string
	) => Promise<unknown>;

	it('hides from a reader the listing guard refuses, without failing the page', async () => {
		roster.requireListingWriter.mockRejectedValueOnce(
			Object.assign(new Error('403'), { status: 403 })
		);
		expect(await getEventRsvpRoster('e1')).toBeNull();
		expect(svc.listRsvpsForEvent).not.toHaveBeenCalled();
	});

	it('still fails a signed-out caller', async () => {
		roster.requireListingWriter.mockRejectedValueOnce(
			Object.assign(new Error('401'), { status: 401 })
		);
		await expect(getEventRsvpRoster('e1')).rejects.toThrow('401');
	});

	it('lists each RSVP as a person, a contact and a time, with the total', async () => {
		const at = new Date('2026-11-01T18:30:00Z');
		svc.listRsvpsForEvent.mockResolvedValueOnce([
			{ id: 'r1', userId: 'u-ada', name: 'Ada', email: 'ada@example.com', createdAt: at }
		]);
		expect(await getEventRsvpRoster('e1')).toEqual({
			total: 1,
			rows: [
				{
					id: 'r1',
					person: { type: 'member', id: 'u-ada', title: 'Ada', subtitle: 'ada@example.com' },
					contact: 'ada@example.com',
					at
				}
			]
		});
		expect(roster.requireListingWriter).toHaveBeenCalledWith('e1');
	});
});
