import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('$app/server', () => ({
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		(handler as unknown as Record<string, unknown>).__ = { type: 'query' };
		return handler;
	},
	form: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		(handler as unknown as Record<string, unknown>).__ = { type: 'form' };
		return handler;
	}
}));

/**
 * Faithful to the real `requireGroupRole`: it resolves the group from the ref
 * it is handed and then checks the caller's role on *that* group. Mocking it as
 * a bare `vi.fn()` would let every test below pass a forged slug and get the
 * caller's own band back, which is precisely the failure these tests exist to
 * rule out.
 */
const ROLES: Record<string, string | undefined> = { 'our-band': 'admin' };
const requireGroupRole = vi.fn(async (ref: { slug?: string }, minRole: string, _opts?: unknown) => {
	const slug = ref.slug!;
	const role = ROLES[slug];
	if (!role) throw Object.assign(new Error('Not a member of this group'), { status: 403 });
	if (minRole === 'owner' && role !== 'owner') {
		throw Object.assign(new Error('Insufficient permissions'), { status: 403 });
	}
	return { user: { id: 'user-1' }, group: { id: 'band-1', slug, name: 'Our Band' }, role };
});
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (...a: unknown[]) =>
		requireGroupRole(...(a as [{ slug?: string }, string, unknown?]))
}));

const listBandEvents = vi.fn(async () => [] as unknown[]);
const getEventLineups = vi.fn(async () => new Map());
const getEventLineup = vi.fn(async () => [] as unknown[]);
const getById = vi.fn(async () => null as unknown);
const updateBandEvent = vi.fn(async () => undefined);
vi.mock('$lib/server/event/event-service', () => ({
	listBandEvents: (...a: unknown[]) => listBandEvents(...(a as [])),
	getEventLineups: (...a: unknown[]) => getEventLineups(...(a as [])),
	getEventLineup: (...a: unknown[]) => getEventLineup(...(a as [])),
	getById: (...a: unknown[]) => getById(...(a as [])),
	createBandEvent: vi.fn(),
	updateBandEvent: (...a: unknown[]) => updateBandEvent(...(a as [])),
	cancelBandEvent: vi.fn(),
	importBandEvents: vi.fn(),
	clearBandEventPoster: vi.fn(),
	setEventLineup: vi.fn(),
	confirmLineupSlot: vi.fn(),
	declineLineupSlot: vi.fn(),
	listBandLineupInvites: vi.fn(async () => []),
	publish: vi.fn(),
	unpublish: vi.fn()
}));

vi.mock('$lib/server/band/band-service', () => ({ searchBandsByName: vi.fn(async () => []) }));
vi.mock('$lib/server/storage', () => ({
	resolveImageUrl: (k: string | null) => k,
	validateUpload: vi.fn(() => null)
}));

import {
	getBandEvents,
	getBandEventDetail,
	updateBandEventForm,
	publishBandEvent
} from './band-events.remote';

const OWN_BAND = { id: 'band-1', slug: 'our-band', name: 'Our Band' };

beforeEach(() => {
	requireGroupRole.mockClear();
	listBandEvents.mockClear();
	getById.mockReset();
	getEventLineup.mockReset();
	getEventLineups.mockReset();
	getEventLineups.mockResolvedValue(new Map());
	updateBandEvent.mockClear();
});

// ---------------------------------------------------------------------------
// Regression: these two queries return *unpublished drafts*, but were gated
// only on requireUser(). Any signed-in user could read another band's
// unannounced gigs by passing that band's slug. The guard is now
// membership-or-staff, resolved from the slug the caller passes.
// ---------------------------------------------------------------------------

describe('getBandEvents', () => {
	it('refuses a signed-in user who is not in the band', async () => {
		await expect(getBandEvents('someone-elses-band')).rejects.toThrow(/not a member/i);
		expect(listBandEvents).not.toHaveBeenCalled();
	});

	/**
	 * The slug is a lookup key, not a capability. Since phase 4 the guard reads
	 * it from this argument rather than the request path, so the property worth
	 * pinning has moved: a forged slug no longer resolves to the caller's own
	 * band, it resolves to the band it names — where the caller has no role.
	 */
	it('reads the band the caller named, and 403s when they hold no role there', async () => {
		await getBandEvents('our-band');
		expect(requireGroupRole).toHaveBeenCalledWith({ slug: 'our-band' }, 'member', {
			allowStaff: true
		});
		expect(listBandEvents).toHaveBeenCalledWith(OWN_BAND.id);

		listBandEvents.mockClear();
		await expect(getBandEvents('a-slug-the-client-made-up')).rejects.toThrow(/not a member/i);
		expect(listBandEvents).not.toHaveBeenCalled();
	});
});

describe('getBandEventDetail', () => {
	it('refuses a non-member', async () => {
		await expect(
			getBandEventDetail({ slug: 'someone-elses-band', eventId: 'evt-1' })
		).rejects.toThrow(/not a member/i);
	});

	it('404s an event belonging to another band', async () => {
		getById.mockResolvedValue({ id: 'evt-9', bandId: 'other-band', lineup: [] });
		getEventLineup.mockResolvedValue([]);

		await expect(getBandEventDetail({ slug: 'our-band', eventId: 'evt-9' })).rejects.toThrow();
	});

	// A support act needs to see the gig it was added to, or it cannot decide
	// whether to confirm.
	it('admits a band credited on the bill, not just the owner', async () => {
		getById.mockResolvedValue({
			id: 'evt-9',
			bandId: 'other-band',
			title: 'Their Show',
			startsAt: new Date(),
			endsAt: null,
			doorsAt: null,
			status: 'published',
			location: null,
			tags: null,
			description: null,
			externalTicketUrl: null,
			ticketPrice: null,
			posterKey: null
		});
		getEventLineup.mockResolvedValue([
			{ id: 'eb-1', name: 'Our Band', bandId: OWN_BAND.id, status: 'pending' }
		]);

		const detail = await getBandEventDetail({ slug: 'our-band', eventId: 'evt-9' });
		expect(detail).toMatchObject({ id: 'evt-9', isOwner: false });
	});
});

// ---------------------------------------------------------------------------
// The edit form
// ---------------------------------------------------------------------------

describe('updateBandEventForm', () => {
	const issue = new Proxy(
		{},
		{ get: (_t, name: string) => (message: string) => ({ name, message }) }
	) as never;

	// `tags` was in the schema and written by the handler from the start, but no
	// input ever rendered on the edit side — so a typo'd tag was permanent. The
	// field now lives in EventFields, shared by create and edit.
	it('persists tags', async () => {
		await (updateBandEventForm as unknown as (d: unknown, i: unknown) => Promise<unknown>)(
			{ slug: 'our-band', eventId: 'evt-1', tags: 'punk, all-ages' },
			issue
		);

		expect(updateBandEvent).toHaveBeenCalledWith(
			'evt-1',
			'band-1',
			expect.objectContaining({ tags: 'punk, all-ages' })
		);
	});

	/**
	 * The `slug` field these forms have always carried used to be decorative —
	 * the band came from the request path. It is the ref now, which makes this
	 * the test that matters: submitting someone else's slug must reach *their*
	 * band in the guard, where the caller has no role, rather than silently
	 * acting on the caller's own.
	 */
	it('acts on the band the submission names, and 403s when the caller has no role there', async () => {
		await expect(
			(updateBandEventForm as unknown as (d: unknown, i: unknown) => Promise<unknown>)(
				{ slug: 'some-other-band', eventId: 'evt-1', title: 'New title' },
				issue
			)
		).rejects.toThrow(/not a member/i);
		expect(updateBandEvent).not.toHaveBeenCalled();
	});

	it('is refused for a non-admin', async () => {
		requireGroupRole.mockRejectedValueOnce(new Error('Insufficient permissions'));

		await expect(
			(updateBandEventForm as unknown as (d: unknown, i: unknown) => Promise<unknown>)(
				{ slug: 'our-band', eventId: 'evt-1', title: 'Nope' },
				issue
			)
		).rejects.toThrow();
		expect(updateBandEvent).not.toHaveBeenCalled();
	});
});

describe('publishBandEvent', () => {
	it('publishes an event belonging to the band the submission names', async () => {
		getById.mockResolvedValue({ id: 'evt-1', bandId: 'band-1', status: 'draft' });

		await expect(
			(publishBandEvent as unknown as (d: unknown, i: unknown) => Promise<unknown>)(
				{ slug: 'our-band', eventId: 'evt-1' },
				undefined
			)
		).resolves.toBeDefined();
		expect(requireGroupRole).toHaveBeenCalledWith({ slug: 'our-band' }, 'admin');
	});
});
