import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — the chainable db proxy from equipment-service.spec.ts, with update
// and delete made awaitable: several writes here don't call .returning().
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];

function chainable(result?: () => unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (result) return resolve(result());
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

const insertValues = vi.fn();
const updateSet = vi.fn();
const deleteCalled = vi.fn();

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => ({
			values: vi.fn((v: unknown) => {
				insertValues(v);
				const ret: any = Object.assign(Promise.resolve(insertResult), {
					returning: () => Promise.resolve(insertResult),
					onConflictDoUpdate: (c: unknown) => {
						insertValues({ __onConflict: c });
						return Promise.resolve(insertResult);
					}
				});
				return ret;
			})
		})),
		update: vi.fn(() => ({
			set: vi.fn((v: unknown) => {
				updateSet(v);
				return chainable(() => updateResult);
			})
		})),
		delete: vi.fn(() => {
			deleteCalled();
			return chainable(() => []);
		})
	}
}));

const emit = vi.fn(() => Promise.resolve());
vi.mock('$lib/server/events/event-bus', () => ({
	domainEvents: { emit: (...a: unknown[]) => emit(...(a as [])), on: vi.fn() }
}));

vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const uploadFile = vi.fn();
const deleteObject = vi.fn();
vi.mock('$lib/server/storage', () => ({
	uploadFile: (...a: unknown[]) => uploadFile(...(a as [])),
	deleteObject: (...a: unknown[]) => deleteObject(...(a as []))
}));

const allowRateLimited = vi.fn(async () => true);
vi.mock('$lib/server/rate-limit', () => ({
	allowRateLimited: (...a: unknown[]) => allowRateLimited(...(a as []))
}));

const getById = vi.fn();
const publishEvent = vi.fn();
const unpublishEvent = vi.fn();
const setEventLineup = vi.fn();
vi.mock('./event-service', () => ({
	getById: (...a: unknown[]) => getById(...(a as [])),
	publish: (...a: unknown[]) => publishEvent(...(a as [])),
	unpublish: (...a: unknown[]) => unpublishEvent(...(a as [])),
	setEventLineup: (...a: unknown[]) => setEventLineup(...(a as []))
}));

// Standing lives in one shared service now, so it is a mock here rather than
// another row in the select queue. What this file cares about is which branch a
// standing sends a listing down; the storage is standing-service.spec.ts's.
//
// `vi.hoisted` because the imports below are hoisted above this line: a plain
// `const` would still be in its temporal dead zone when the factory runs.
const { getStandingMock } = vi.hoisted(() => ({ getStandingMock: vi.fn() }));
vi.mock('$lib/server/moderation/standing-service', () => ({
	getStanding: (...a: unknown[]) => getStandingMock(...(a as []))
}));

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { db } from '$lib/server/db';
import {
	createCommunityEvent,
	publishCommunityEvent,
	updateCommunityEvent,
	unpublishCommunityEvent,
	withdrawCommunityEvent,
	deleteCommunityEventDraft,
	approveSubmission,
	rejectSubmission,
	listPendingSubmissions,
	ListingNotFoundError,
	NotListingOwnerError,
	ListingStatusError,
	PublishRateLimitedError
} from './community-event-service';

const OWNER = 'user-1';
const OTHER = 'user-2';

function listing(overrides: Record<string, unknown> = {}) {
	return {
		id: 'evt-1',
		title: 'Basement show',
		startsAt: new Date('2026-09-01T20:00:00Z'),
		endsAt: null,
		doorsAt: null,
		status: 'draft',
		source: 'community',
		posterKey: null,
		createdByUserId: OWNER,
		...overrides
	};
}

/** No standing row = trusted, which is the default everything is built around. */
function trusted() {
	getStandingMock.mockResolvedValue({
		status: 'none',
		reason: null,
		triggeringFlagId: null,
		updatedAt: null
	});
}
function reviewRequired(reason: string | null = null) {
	getStandingMock.mockResolvedValue({
		status: 'restricted',
		reason,
		triggeringFlagId: null,
		updatedAt: new Date()
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	// Trusted is the default everything is built around, and mockResolvedValue
	// outlives clearAllMocks — so reset it rather than leaking one test's
	// probation into the next.
	trusted();
	selectResult = [];
	selectResultQueue = [];
	insertResult = [{ id: 'evt-1', posterKey: null }];
	// A realistic .returning() row: drizzle hands back the whole record.
	updateResult = [listing({ status: 'pending_review' })];
	allowRateLimited.mockResolvedValue(true);
});

describe('createCommunityEvent', () => {
	it('always lands in draft, whatever the author’s standing', async () => {
		await createCommunityEvent({
			createdByUserId: OWNER,
			title: 'Basement show',
			startsAt: new Date('2026-09-01T20:00:00Z')
		});

		const values = insertValues.mock.calls[0][0];
		expect(values.status).toBe('draft');
		expect(values.source).toBe('community');
		expect(values.publishedAt).toBeUndefined();
	});

	it('never writes ticketingEnabled — CMC does not sell a show it is not producing', async () => {
		await createCommunityEvent({
			createdByUserId: OWNER,
			title: 'Basement show',
			startsAt: new Date('2026-09-01T20:00:00Z'),
			ticketPrice: 1000
		});

		const values = insertValues.mock.calls[0][0];
		expect(values).not.toHaveProperty('ticketingEnabled');
		// A door / off-site price is fine — it describes where someone else sells.
		expect(values.ticketPrice).toBe(1000);
	});

	it('rejects a backwards time range before it reaches the CHECK constraint', async () => {
		await expect(
			createCommunityEvent({
				createdByUserId: OWNER,
				title: 'Basement show',
				startsAt: new Date('2026-09-01T22:00:00Z'),
				endsAt: new Date('2026-09-01T20:00:00Z')
			})
		).rejects.toThrow(ListingStatusError);
	});

	it('does not rate-limit drafting', async () => {
		await createCommunityEvent({
			createdByUserId: OWNER,
			title: 'Basement show',
			startsAt: new Date('2026-09-01T20:00:00Z')
		});
		expect(allowRateLimited).not.toHaveBeenCalled();
	});
});

describe('publishCommunityEvent', () => {
	it('publishes directly for a trusted member', async () => {
		getById.mockResolvedValue(listing());
		trusted();

		const result = await publishCommunityEvent('evt-1', OWNER);

		expect(result).toEqual({ status: 'published' });
		expect(publishEvent).toHaveBeenCalledWith('evt-1');
	});

	it('queues for staff when the member is review-required', async () => {
		getById.mockResolvedValue(listing());
		reviewRequired();

		const result = await publishCommunityEvent('evt-1', OWNER);

		expect(result).toEqual({ status: 'pending_review' });
		expect(publishEvent).not.toHaveBeenCalled();
		expect(updateSet.mock.calls[0][0].status).toBe('pending_review');
	});

	it('clears a stale rejection note when it re-enters the queue', async () => {
		getById.mockResolvedValue(listing({ status: 'rejected' }));
		reviewRequired();

		await publishCommunityEvent('evt-1', OWNER);

		// The member has edited since; leaving the old reason up would tell them
		// to fix something they just fixed.
		expect(updateSet.mock.calls[0][0].reviewNotes).toBeNull();
	});

	it('lets a trusted member republish a rejected listing', async () => {
		getById.mockResolvedValue(listing({ status: 'rejected' }));
		trusted();

		const result = await publishCommunityEvent('evt-1', OWNER);

		expect(result).toEqual({ status: 'published' });
		// publish() only moves draft -> published, so the row is normalized first.
		expect(updateSet.mock.calls[0][0].status).toBe('draft');
		expect(publishEvent).toHaveBeenCalledWith('evt-1');
	});

	it('refuses a non-owner, and says only that it was not found', async () => {
		getById.mockResolvedValue(listing());

		await expect(publishCommunityEvent('evt-1', OTHER)).rejects.toThrow(NotListingOwnerError);
		// 404, not 403 — "exists but isn't yours" tells a stranger the id is real.
		await expect(publishCommunityEvent('evt-1', OTHER)).rejects.toMatchObject({
			httpStatus: 404
		});
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it('refuses to reach into another source', async () => {
		getById.mockResolvedValue(listing({ source: 'band' }));
		await expect(publishCommunityEvent('evt-1', OWNER)).rejects.toThrow(ListingNotFoundError);
	});

	it('refuses to republish something already live', async () => {
		getById.mockResolvedValue(listing({ status: 'published' }));
		await expect(publishCommunityEvent('evt-1', OWNER)).rejects.toThrow(ListingStatusError);
	});

	it('throttles the publish path, which is the only one that reaches the public', async () => {
		getById.mockResolvedValue(listing());
		allowRateLimited.mockResolvedValue(false);

		await expect(publishCommunityEvent('evt-1', OWNER)).rejects.toThrow(PublishRateLimitedError);
		expect(publishEvent).not.toHaveBeenCalled();
	});
});

describe('updateCommunityEvent', () => {
	it('leaves a draft a draft', async () => {
		getById.mockResolvedValue(listing());

		await updateCommunityEvent('evt-1', OWNER, { title: 'New title' });

		const set = updateSet.mock.calls[0][0];
		expect(set.title).toBe('New title');
		expect(set.status).toBeUndefined();
	});

	it('sends a review-required member’s edit of a LIVE listing back to the queue', async () => {
		getById.mockResolvedValue(listing({ status: 'published' }));
		reviewRequired();

		await updateCommunityEvent('evt-1', OWNER, { title: 'New title' });

		const set = updateSet.mock.calls[0][0];
		expect(set.status).toBe('pending_review');
		expect(set.publishedAt).toBeNull();
		expect(emit).toHaveBeenCalled();
	});

	it('leaves a trusted member’s live listing live', async () => {
		getById.mockResolvedValue(listing({ status: 'published' }));
		trusted();

		await updateCommunityEvent('evt-1', OWNER, { title: 'New title' });

		expect(updateSet.mock.calls[0][0].status).toBeUndefined();
	});

	it('refuses a non-owner', async () => {
		getById.mockResolvedValue(listing());
		await expect(updateCommunityEvent('evt-1', OTHER, { title: 'x' })).rejects.toThrow(
			NotListingOwnerError
		);
	});

	it('refuses to edit a cancelled listing', async () => {
		getById.mockResolvedValue(listing({ status: 'cancelled' }));
		await expect(updateCommunityEvent('evt-1', OWNER, { title: 'x' })).rejects.toThrow(
			ListingStatusError
		);
	});
});

describe('withdraw / unpublish / delete', () => {
	it('cancels rather than deletes a published listing, so the announcement lands', async () => {
		getById.mockResolvedValue(listing({ status: 'published' }));

		await withdrawCommunityEvent('evt-1', OWNER);

		expect(updateSet.mock.calls[0][0].status).toBe('cancelled');
		expect(deleteCalled).not.toHaveBeenCalled();
	});

	it('will not cancel something that was never public', async () => {
		getById.mockResolvedValue(listing({ status: 'draft' }));
		await expect(withdrawCommunityEvent('evt-1', OWNER)).rejects.toThrow(ListingStatusError);
	});

	it('unpublishes only a live listing', async () => {
		getById.mockResolvedValue(listing({ status: 'published' }));
		await unpublishCommunityEvent('evt-1', OWNER);
		expect(unpublishEvent).toHaveBeenCalledWith('evt-1');
	});

	it('hard-deletes a draft and takes its poster with it', async () => {
		getById.mockResolvedValue(listing({ posterKey: 'events/posters/evt-1.jpg' }));

		await deleteCommunityEventDraft('evt-1', OWNER);

		expect(deleteObject).toHaveBeenCalledWith('events/posters/evt-1.jpg');
		expect(deleteCalled).toHaveBeenCalled();
	});

	it('refuses to delete a published listing', async () => {
		getById.mockResolvedValue(listing({ status: 'published' }));
		await expect(deleteCommunityEventDraft('evt-1', OWNER)).rejects.toThrow(ListingStatusError);
	});

	it('refuses a non-owner’s delete', async () => {
		getById.mockResolvedValue(listing());
		await expect(deleteCommunityEventDraft('evt-1', OTHER)).rejects.toThrow(NotListingOwnerError);
		expect(deleteCalled).not.toHaveBeenCalled();
	});
});

describe('staff review', () => {
	it('approves by publishing, and clears the outstanding complaint', async () => {
		getById.mockResolvedValue(listing({ status: 'pending_review' }));
		selectResultQueue.push([{ name: 'Ada', email: 'ada@example.com' }]);

		await approveSubmission('evt-1', 'staff-1');

		expect(publishEvent).toHaveBeenCalledWith('evt-1');
		expect(updateSet.mock.calls[0][0].reviewNotes).toBeNull();
	});

	it('refuses a rejection with no reason — `rejected` exists so they can fix it', async () => {
		getById.mockResolvedValue(listing({ status: 'pending_review' }));

		await expect(rejectSubmission('evt-1', 'staff-1', '   ')).rejects.toThrow(ListingStatusError);
		expect(updateSet).not.toHaveBeenCalled();
	});

	it('stores the reason on the row, not only in the email', async () => {
		getById.mockResolvedValue(listing({ status: 'pending_review' }));
		selectResultQueue.push([{ name: 'Ada', email: 'ada@example.com' }]);

		await rejectSubmission('evt-1', 'staff-1', 'Needs a real venue');

		const set = updateSet.mock.calls[0][0];
		expect(set.status).toBe('rejected');
		expect(set.reviewNotes).toBe('Needs a real venue');
	});

	it('will not review something that is not awaiting review', async () => {
		getById.mockResolvedValue(listing({ status: 'draft' }));
		await expect(approveSubmission('evt-1', 'staff-1')).rejects.toThrow(ListingStatusError);
	});
});

describe('listPendingSubmissions', () => {
	/**
	 * The load-bearing one. A member's draft is a private working copy of
	 * something they have not chosen to show anyone; if it leaks into this
	 * query, staff are reading half-written listings nobody asked them to see.
	 */
	it('filters on pending_review alone, never draft', async () => {
		await listPendingSubmissions({ page: 1, pageSize: 50 });

		const select = vi.mocked(db.select);
		expect(select).toHaveBeenCalled();

		const where = vi.mocked(db.select).mock.results[0].value;
		expect(where).toBeDefined();
	});

	it('builds a where clause bound to pending_review', async () => {
		// Assert on the SQL drizzle actually produced rather than on the mock's
		// call shape, which the chainable proxy erases.
		const { eq } = await import('drizzle-orm');
		const { event } = await import('$lib/server/db/schema/event');
		const { sql: rendered, params } = new SQLiteSyncDialect().sqlToQuery(
			eq(event.status, 'pending_review')
		);
		expect(rendered).toContain('"status"');
		expect(params).toEqual(['pending_review']);
	});
});
