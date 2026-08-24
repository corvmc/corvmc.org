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

/** Stands in for the band-context guard, which resolves the band from the path. */
const requireBandMemberOrStaff = vi.fn();
const requireBandAdmin = vi.fn();
vi.mock('$lib/server/band/band-context', () => ({
	requireBandMemberOrStaff: (...a: unknown[]) => requireBandMemberOrStaff(...(a as [])),
	requireBandAdmin: (...a: unknown[]) => requireBandAdmin(...(a as []))
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
	requireBandMemberOrStaff.mockReset();
	requireBandAdmin.mockReset();
	listBandEvents.mockClear();
	getById.mockReset();
	getEventLineup.mockReset();
	getEventLineups.mockReset();
	getEventLineups.mockResolvedValue(new Map());
	updateBandEvent.mockClear();
});

// ---------------------------------------------------------------------------
// Regression: these two queries return *unpublished drafts*, but gated only on
// requireUser(). Any signed-in user could read another band's unannounced gigs
// by passing that band's slug. The guard is now membership-or-staff.
// ---------------------------------------------------------------------------

describe('getBandEvents', () => {
	it('refuses a signed-in user who is not in the band', async () => {
		requireBandMemberOrStaff.mockRejectedValue(
			Object.assign(new Error('Not a member of this band'), { status: 403 })
		);

		await expect(getBandEvents('someone-elses-band')).rejects.toThrow(/not a member/i);
		expect(listBandEvents).not.toHaveBeenCalled();
	});

	it('reads the band from the guard, never from the caller-supplied slug', async () => {
		requireBandMemberOrStaff.mockResolvedValue({ band: OWN_BAND, role: 'admin' });

		await getBandEvents('a-slug-the-client-made-up');

		// The slug argument is decorative: band-context resolves the band from the
		// request path, so a forged argument cannot widen access.
		expect(listBandEvents).toHaveBeenCalledWith(OWN_BAND.id);
	});
});

describe('getBandEventDetail', () => {
	it('refuses a non-member', async () => {
		requireBandMemberOrStaff.mockRejectedValue(
			Object.assign(new Error('Not a member of this band'), { status: 403 })
		);

		await expect(
			getBandEventDetail({ slug: 'someone-elses-band', eventId: 'evt-1' })
		).rejects.toThrow(/not a member/i);
	});

	it('404s an event belonging to another band', async () => {
		requireBandMemberOrStaff.mockResolvedValue({ band: OWN_BAND, role: 'admin' });
		getById.mockResolvedValue({ id: 'evt-9', bandId: 'other-band', lineup: [] });
		getEventLineup.mockResolvedValue([]);

		await expect(getBandEventDetail({ slug: 'our-band', eventId: 'evt-9' })).rejects.toThrow();
	});

	// A support act needs to see the gig it was added to, or it cannot decide
	// whether to confirm.
	it('admits a band credited on the bill, not just the owner', async () => {
		requireBandMemberOrStaff.mockResolvedValue({ band: OWN_BAND, role: 'admin' });
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

	beforeEach(() => {
		requireBandAdmin.mockResolvedValue({ band: OWN_BAND, user: { id: 'user-1' }, role: 'admin' });
	});

	// `tags` was in the schema and written by the handler from the start, but no
	// input ever rendered on the edit side — so a typo'd tag was permanent. The
	// field now lives in EventFields, shared by create and edit.
	it('persists tags', async () => {
		await (updateBandEventForm as unknown as (d: unknown, i: unknown) => Promise<unknown>)(
			{ eventId: 'evt-1', tags: 'punk, all-ages' },
			issue
		);

		expect(updateBandEvent).toHaveBeenCalledWith(
			'evt-1',
			'band-1',
			expect.objectContaining({ tags: 'punk, all-ages' })
		);
	});

	// Every band-event form carried a `slug` field that no handler ever read —
	// the band comes from the guard. Dropping it must not change which band a
	// mutation lands on.
	it('resolves its band from the guard, not from any submitted field', async () => {
		await (updateBandEventForm as unknown as (d: unknown, i: unknown) => Promise<unknown>)(
			{ eventId: 'evt-1', title: 'New title', slug: 'some-other-band' },
			issue
		);

		expect(updateBandEvent).toHaveBeenCalledWith('evt-1', 'band-1', expect.anything());
	});

	it('is refused for a non-admin', async () => {
		requireBandAdmin.mockRejectedValue(new Error('Insufficient permissions'));

		await expect(
			(updateBandEventForm as unknown as (d: unknown, i: unknown) => Promise<unknown>)(
				{ eventId: 'evt-1', title: 'Nope' },
				issue
			)
		).rejects.toThrow();
		expect(updateBandEvent).not.toHaveBeenCalled();
	});
});

describe('publishBandEvent', () => {
	it('takes its band from the guard with no slug field submitted', async () => {
		requireBandAdmin.mockResolvedValue({ band: OWN_BAND, user: { id: 'user-1' }, role: 'admin' });
		getById.mockResolvedValue({ id: 'evt-1', bandId: 'band-1', status: 'draft' });

		await expect(
			(publishBandEvent as unknown as (d: unknown, i: unknown) => Promise<unknown>)(
				{ eventId: 'evt-1' },
				undefined
			)
		).resolves.toBeDefined();
	});
});
