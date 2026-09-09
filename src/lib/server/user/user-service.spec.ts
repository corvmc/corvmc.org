import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResultQueue: unknown[][] = [];
let updateResult: unknown[] = [];

function chainableSelect() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) =>
					resolve(selectResultQueue.length > 0 ? selectResultQueue.shift()! : []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

const deleteWhere = vi.fn(() => Promise.resolve({ rowCount: 1 }));
const updateSet = vi.fn(() => ({
	where: vi.fn(() => ({
		returning: vi.fn(() => Promise.resolve(updateResult))
	}))
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainableSelect(),
		update: vi.fn(() => ({ set: updateSet })),
		delete: vi.fn(() => ({ where: deleteWhere }))
	}
}));

const cancelMock = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/reservation/reservation-service', () => ({
	cancel: (...args: unknown[]) => cancelMock(...args)
}));

const subCancelMock = vi.fn().mockResolvedValue(undefined);
const countPublishedListingsBy = vi.fn(async () => 0);
vi.mock('$lib/server/event/community-event-service', () => ({
	countPublishedListingsBy: (...a: unknown[]) => countPublishedListingsBy(...(a as []))
}));

const subResumeMock = vi.fn().mockResolvedValue(undefined);
const getSubscriptionMock = vi.fn(async () => null as { cancelAtPeriodEnd: boolean } | null);
vi.mock('$lib/server/finance/subscription-service', () => ({
	cancel: (...args: unknown[]) => subCancelMock(...args),
	resume: (...args: unknown[]) => subResumeMock(...args),
	getSubscription: (...args: unknown[]) => getSubscriptionMock(...(args as []))
}));

const revokeMemberCodeMock = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/lock/member-code-service', () => ({
	revokeMemberCode: (...args: unknown[]) => revokeMemberCodeMock(...args)
}));

vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

import {
	deactivateUser,
	deactivateUsers,
	reactivateUser,
	purgeUser,
	ensureContactPhone,
	UserNotFoundError,
	UserNotDeactivatedError,
	UserHasOwnedBandsError,
	UserHasPublishedListingsError
} from './user-service';

beforeEach(() => {
	selectResultQueue = [];
	updateResult = [];
	cancelMock.mockClear();
	subCancelMock.mockClear();
	subResumeMock.mockClear();
	subResumeMock.mockResolvedValue(undefined);
	getSubscriptionMock.mockClear();
	getSubscriptionMock.mockResolvedValue(null);
	revokeMemberCodeMock.mockClear();
	revokeMemberCodeMock.mockResolvedValue(undefined);
	deleteWhere.mockClear();
	updateSet.mockClear();
});

// ---------------------------------------------------------------------------
// deactivateUser
// ---------------------------------------------------------------------------

describe('deactivateUser', () => {
	it('cancels future reservations and returns the row', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[], [{ id: 'r1' }, { id: 'r2' }]]; // door codes, future reservations

		const row = await deactivateUser('u1');

		expect(row).toMatchObject({ id: 'u1' });
		expect(cancelMock).toHaveBeenCalledTimes(2);
		expect(cancelMock).toHaveBeenCalledWith('r1', 'u1', 'Account deactivated', {
			staffOverride: true
		});
	});

	it('purges the user session rows', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[], []]; // no door codes, no future reservations

		await deactivateUser('u1');

		expect(deleteWhere).toHaveBeenCalledTimes(1);
	});

	it('cancels the Stripe subscription when the user has a stripeId', async () => {
		updateResult = [{ id: 'u1', stripeId: 'cus_1', deletedAt: new Date() }];
		selectResultQueue = [[], []];

		await deactivateUser('u1');

		expect(subCancelMock).toHaveBeenCalledWith('cus_1');
	});

	it('skips subscription cancel when the user has no stripeId', async () => {
		updateResult = [{ id: 'u1', stripeId: null, deletedAt: new Date() }];
		selectResultQueue = [[], []];

		await deactivateUser('u1');

		expect(subCancelMock).not.toHaveBeenCalled();
	});

	// A removed member could still open the building: nothing ages a door code
	// out, and offboarding never told the lock. #809.
	it('revokes the standing door codes the member still holds', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[{ id: 'mc1' }, { id: 'mc2' }], []];

		await deactivateUser('u1');

		expect(revokeMemberCodeMock).toHaveBeenCalledTimes(2);
		expect(revokeMemberCodeMock).toHaveBeenCalledWith('mc1', 'Account deactivated');
	});

	it('completes the removal when the lock cannot be reached', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[{ id: 'mc1' }], [{ id: 'r1' }]];
		revokeMemberCodeMock.mockRejectedValueOnce(new Error('lock offline'));

		const row = await deactivateUser('u1');

		expect(row).toMatchObject({ id: 'u1' });
		expect(cancelMock).toHaveBeenCalledTimes(1);
	});

	it('throws UserNotFoundError when already deactivated / missing', async () => {
		updateResult = []; // no row updated (deletedAt was already set)
		await expect(deactivateUser('u1')).rejects.toBeInstanceOf(UserNotFoundError);
		expect(deleteWhere).not.toHaveBeenCalled();
	});
});

describe('deactivateUsers', () => {
	it('deactivates multiple users', async () => {
		updateResult = [{ id: 'x', deletedAt: new Date() }];
		selectResultQueue = [[], [], [], []]; // door codes + future reservations per user

		const res = await deactivateUsers(['u1', 'u2']);

		expect(res.deactivated).toEqual(['u1', 'u2']);
		expect(res.skipped).toEqual([]);
	});

	it('skips skipUserId without touching the DB and skips not-found ids', async () => {
		updateResult = []; // any update finds no row -> UserNotFoundError

		const res = await deactivateUsers(['me', 'u2'], { skipUserId: 'me' });

		expect(res.deactivated).toEqual([]);
		expect(res.skipped).toEqual(['me', 'u2']); // 'me' self-skip, 'u2' already-deactivated/missing
	});
});

describe('reactivateUser', () => {
	it('throws UserNotFoundError when not deactivated', async () => {
		updateResult = [];
		await expect(reactivateUser('u1')).rejects.toBeInstanceOf(UserNotFoundError);
	});

	// deactivateUser cancels at period end, so inside the period the membership
	// is restorable with the call resume() already implements. #810.
	it('resumes a subscription that was only cancelled at period end', async () => {
		updateResult = [{ id: 'u1', stripeId: 'cus_1', deletedAt: null }];
		getSubscriptionMock.mockResolvedValueOnce({ cancelAtPeriodEnd: true });

		const row = await reactivateUser('u1');

		expect(subResumeMock).toHaveBeenCalledWith('cus_1');
		expect(row.subscription).toBe('resumed');
	});

	it('reports a subscription that already elapsed as lapsed', async () => {
		updateResult = [{ id: 'u1', stripeId: 'cus_1', deletedAt: null }];
		getSubscriptionMock.mockResolvedValueOnce(null);

		const row = await reactivateUser('u1');

		expect(subResumeMock).not.toHaveBeenCalled();
		expect(row.subscription).toBe('lapsed');
	});

	it('leaves a subscription that was never cancelled alone', async () => {
		updateResult = [{ id: 'u1', stripeId: 'cus_1', deletedAt: null }];
		getSubscriptionMock.mockResolvedValueOnce({ cancelAtPeriodEnd: false });

		const row = await reactivateUser('u1');

		expect(subResumeMock).not.toHaveBeenCalled();
		expect(row.subscription).toBe('active');
	});

	it('reports no subscription when the member never had one', async () => {
		updateResult = [{ id: 'u1', stripeId: null, deletedAt: null }];

		const row = await reactivateUser('u1');

		expect(getSubscriptionMock).not.toHaveBeenCalled();
		expect(row.subscription).toBe('none');
	});
});

// ---------------------------------------------------------------------------
// purgeUser
// ---------------------------------------------------------------------------

describe('purgeUser', () => {
	it('refuses to purge a user that is not deactivated', async () => {
		selectResultQueue = [[{ id: 'u1', deletedAt: null }]];
		await expect(purgeUser('u1')).rejects.toBeInstanceOf(UserNotDeactivatedError);
		expect(deleteWhere).not.toHaveBeenCalled();
	});

	it('refuses to purge a user that still owns a band', async () => {
		selectResultQueue = [
			[{ id: 'u1', deletedAt: new Date() }], // target lookup
			[{ value: 2 }] // owned band count
		];
		await expect(purgeUser('u1')).rejects.toBeInstanceOf(UserHasOwnedBandsError);
		expect(deleteWhere).not.toHaveBeenCalled();
	});

	it('deletes a deactivated user with no owned bands', async () => {
		selectResultQueue = [[{ id: 'u1', deletedAt: new Date() }], [{ value: 0 }]];
		countPublishedListingsBy.mockResolvedValueOnce(0);
		await purgeUser('u1');
		expect(deleteWhere).toHaveBeenCalledTimes(1);
	});

	// event.createdByUserId cascades, so purging would take this member's
	// listings off the public calendar with them. The shows still happen after
	// someone leaves, and other people's plans are attached to them — so a
	// staffer has to deal with the listings on purpose rather than discovering
	// later that the calendar lost a week of gigs.
	it('refuses to purge a member who has listings on the public calendar', async () => {
		selectResultQueue = [[{ id: 'u1', deletedAt: new Date() }], [{ value: 0 }]];
		countPublishedListingsBy.mockResolvedValueOnce(3);

		await expect(purgeUser('u1')).rejects.toBeInstanceOf(UserHasPublishedListingsError);
		expect(deleteWhere).not.toHaveBeenCalled();
	});

	it('throws UserNotFoundError when the user does not exist', async () => {
		selectResultQueue = [[]];
		await expect(purgeUser('u1')).rejects.toBeInstanceOf(UserNotFoundError);
	});
});

// ---------------------------------------------------------------------------
// ensureContactPhone
// ---------------------------------------------------------------------------

describe('ensureContactPhone', () => {
	it('saves a 9-digit submission with its leading 1 restored', async () => {
		selectResultQueue = [[{ phone: null }]];

		const ok = await ensureContactPhone('u1', '415-550-123');

		expect(ok).toBe(true);
		expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ phone: '1415550123' }));
	});

	it('stores a 10-digit submission as bare digits', async () => {
		selectResultQueue = [[{ phone: null }]];

		const ok = await ensureContactPhone('u1', '(541) 555-0123');

		expect(ok).toBe(true);
		expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ phone: '5415550123' }));
	});

	it('leaves an already-usable stored number untouched', async () => {
		selectResultQueue = [[{ phone: '(541) 555-0123' }]];

		const ok = await ensureContactPhone('u1', '999-999-9999');

		expect(ok).toBe(true);
		expect(updateSet).not.toHaveBeenCalled();
	});

	it('rejects when nothing is on file and nothing usable was submitted', async () => {
		selectResultQueue = [[{ phone: 'n/a' }]];

		const ok = await ensureContactPhone('u1', '1234');

		expect(ok).toBe(false);
		expect(updateSet).not.toHaveBeenCalled();
	});
});
