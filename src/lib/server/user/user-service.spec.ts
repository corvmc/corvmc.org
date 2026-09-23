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

const recordAuditEntry = vi.fn(async (_entry: unknown) => undefined);
vi.mock('$lib/server/audit/audit-service', () => ({
	recordAuditEntry: (entry: unknown) => recordAuditEntry(entry)
}));
const sendSuspendedMock = vi.fn().mockResolvedValue(undefined);
const sendRestoredMock = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/auth-emails', () => ({
	sendAccountSuspendedEmail: (...args: unknown[]) => sendSuspendedMock(...args),
	sendAccountRestoredEmail: (...args: unknown[]) => sendRestoredMock(...args)
}));

import {
	deactivateUser,
	deactivateUsers,
	reactivateUser,
	purgeUser,
	ensureContactPhone,
	UserNotFoundError,
	UserNotDeactivatedError,
	UserHasOwnedBandsError,
	UserHasPublishedListingsError,
	banUser,
	unbanUser,
	CannotBanSelfError,
	UserBannedError
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
	recordAuditEntry.mockClear();
	sendSuspendedMock.mockClear();
	sendRestoredMock.mockClear();
});

// ---------------------------------------------------------------------------
// deactivateUser
// ---------------------------------------------------------------------------

describe('deactivateUser', () => {
	it('cancels future reservations and returns the row', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[], [{ id: 'r1' }, { id: 'r2' }]]; // door codes, future reservations

		const row = await deactivateUser('u1', { actor: 'staff' });

		expect(row).toMatchObject({ id: 'u1' });
		expect(cancelMock).toHaveBeenCalledTimes(2);
		expect(cancelMock).toHaveBeenCalledWith('r1', 'u1', 'Account deactivated', {
			staffOverride: true,
			actor: 'staff'
		});
	});

	/**
	 * Regression for #1189. Offboarding is one entry point for two actors — staff
	 * deactivating a member, and a member closing their own account — and it read
	 * `staffOverride` as the attribution for both. A member who closed their own
	 * account was emailed that CMC staff had cancelled their bookings.
	 */
	it('attributes a self-delete to the member, so no email goes out', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[], [{ id: 'res-1' }]];

		await deactivateUser('u1', { actor: 'member' });

		expect(cancelMock).toHaveBeenCalledWith(
			'res-1',
			'u1',
			'Account deactivated',
			expect.objectContaining({ actor: 'member' })
		);
	});

	it('attributes a staff deactivation to staff', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[], [{ id: 'res-1' }]];

		await deactivateUser('u1', { actor: 'staff' });

		expect(cancelMock).toHaveBeenCalledWith(
			'res-1',
			'u1',
			'Account deactivated',
			expect.objectContaining({ actor: 'staff' })
		);
	});

	it('purges the user session rows', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[], []]; // no door codes, no future reservations

		await deactivateUser('u1', { actor: 'staff' });

		expect(deleteWhere).toHaveBeenCalledTimes(1);
	});

	it('cancels the Stripe subscription when the user has a stripeId', async () => {
		updateResult = [{ id: 'u1', stripeId: 'cus_1', deletedAt: new Date() }];
		selectResultQueue = [[], []];

		await deactivateUser('u1', { actor: 'staff' });

		expect(subCancelMock).toHaveBeenCalledWith('cus_1');
	});

	it('skips subscription cancel when the user has no stripeId', async () => {
		updateResult = [{ id: 'u1', stripeId: null, deletedAt: new Date() }];
		selectResultQueue = [[], []];

		await deactivateUser('u1', { actor: 'staff' });

		expect(subCancelMock).not.toHaveBeenCalled();
	});

	// A removed member could still open the building: nothing ages a door code
	// out, and offboarding never told the lock. #809.
	it('revokes the standing door codes the member still holds', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[{ id: 'mc1' }, { id: 'mc2' }], []];

		await deactivateUser('u1', { actor: 'staff' });

		expect(revokeMemberCodeMock).toHaveBeenCalledTimes(2);
		expect(revokeMemberCodeMock).toHaveBeenCalledWith('mc1', 'Account deactivated');
	});

	it('completes the removal when the lock cannot be reached', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date() }];
		selectResultQueue = [[{ id: 'mc1' }], [{ id: 'r1' }]];
		revokeMemberCodeMock.mockRejectedValueOnce(new Error('lock offline'));

		const row = await deactivateUser('u1', { actor: 'staff' });

		expect(row).toMatchObject({ id: 'u1' });
		expect(cancelMock).toHaveBeenCalledTimes(1);
	});

	it('throws UserNotFoundError when already deactivated / missing', async () => {
		updateResult = []; // no row updated (deletedAt was already set)
		await expect(deactivateUser('u1', { actor: 'staff' })).rejects.toBeInstanceOf(
			UserNotFoundError
		);
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
// banUser / unbanUser
// ---------------------------------------------------------------------------

describe('banUser', () => {
	it('records who banned the member and why, then deactivates them', async () => {
		updateResult = [{ id: 'u1', deletedAt: null, stripeId: null }];
		selectResultQueue = [[], [{ id: 'r1' }]]; // door codes, future reservations

		await banUser('u1', { actorId: 'staff-1', reason: 'Threatened another member' });

		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				bannedAt: expect.any(Date),
				bannedById: 'staff-1',
				banReason: 'Threatened another member'
			})
		);
		// The offboarding path ran: a second update set deletedAt, and the
		// member's future booking was released.
		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ deletedAt: expect.any(Date) })
		);
		expect(cancelMock).toHaveBeenCalledWith('r1', 'u1', 'Account deactivated', {
			staffOverride: true,
			actor: 'staff'
		});
	});

	it('bans an already-deactivated account without re-running offboarding', async () => {
		updateResult = [{ id: 'u1', deletedAt: new Date('2026-01-01'), stripeId: null }];

		await banUser('u1', { actorId: 'staff-1', reason: 'Left, then harassed members by email' });

		expect(updateSet).toHaveBeenCalledTimes(1);
		expect(deleteWhere).not.toHaveBeenCalled();
		expect(cancelMock).not.toHaveBeenCalled();
	});

	// The notice states the fact; the reason is a staff record and stays one.
	it('emails the member that the account is suspended, without the reason', async () => {
		updateResult = [
			{ id: 'u1', email: 'maya@example.com', name: 'Maya', deletedAt: new Date(), stripeId: null }
		];

		await banUser('u1', { actorId: 'staff-1', reason: 'Threatened another member' });

		expect(sendSuspendedMock).toHaveBeenCalledWith({ toEmail: 'maya@example.com', name: 'Maya' });
		expect(JSON.stringify(sendSuspendedMock.mock.calls)).not.toContain('Threatened');
	});

	it('writes a user.banned entry carrying the reason', async () => {
		updateResult = [
			{ id: 'u1', name: 'Jordan', deletedAt: new Date('2026-01-01'), stripeId: null }
		];

		await banUser('u1', { actorId: 'staff-1', reason: 'Threatened another member' });

		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'user.banned',
			subject: { type: 'user', id: 'u1', label: 'Jordan' },
			details: { reason: 'Threatened another member' }
		});
	});

	it('refuses to let staff ban themselves', async () => {
		await expect(banUser('u1', { actorId: 'u1', reason: 'x' })).rejects.toBeInstanceOf(
			CannotBanSelfError
		);
		expect(updateSet).not.toHaveBeenCalled();
	});

	it('throws UserNotFoundError when the account is missing or already banned', async () => {
		updateResult = [];
		await expect(banUser('u1', { actorId: 'staff-1', reason: 'x' })).rejects.toBeInstanceOf(
			UserNotFoundError
		);
	});
});

describe('reactivateUser on a banned account', () => {
	it('refuses, so a ban is only ever lifted on purpose', async () => {
		updateResult = [];
		selectResultQueue = [[{ bannedAt: new Date() }]];
		await expect(reactivateUser('u1')).rejects.toBeInstanceOf(UserBannedError);
	});
});

describe('unbanUser', () => {
	it('clears the ban record and restores the account', async () => {
		updateResult = [{ id: 'u1', stripeId: 'cus_1', deletedAt: null }];
		getSubscriptionMock.mockResolvedValueOnce({ cancelAtPeriodEnd: true });

		const row = await unbanUser('u1');

		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ bannedAt: null, bannedById: null, banReason: null })
		);
		expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ deletedAt: null }));
		expect(row.subscription).toBe('resumed');
	});

	it('emails the member that the account is restored', async () => {
		updateResult = [{ id: 'u1', email: 'maya@example.com', name: 'Maya', stripeId: null }];

		await unbanUser('u1');

		expect(sendRestoredMock).toHaveBeenCalledWith({ toEmail: 'maya@example.com', name: 'Maya' });
	});

	it('writes a user.unbanned entry before restoring the account', async () => {
		updateResult = [{ id: 'u1', name: 'Jordan', stripeId: null, deletedAt: null }];

		await unbanUser('u1');

		expect(recordAuditEntry.mock.calls.map(([e]) => (e as { action: string }).action)).toEqual([
			'user.unbanned',
			'user.reactivated'
		]);
		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'user.unbanned',
			subject: { type: 'user', id: 'u1', label: 'Jordan' },
			details: {}
		});
	});

	it('throws UserNotFoundError when the account is not banned', async () => {
		updateResult = [];
		await expect(unbanUser('u1')).rejects.toBeInstanceOf(UserNotFoundError);
		expect(sendRestoredMock).not.toHaveBeenCalled();
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
// Audit trail. Recorded here rather than in each remote, because a member
// closing their own account and staff closing it run the same function.
// ---------------------------------------------------------------------------

describe('audit entries', () => {
	it('records a deactivation with what it cancelled', async () => {
		updateResult = [{ id: 'u1', name: 'Jordan', stripeId: 'cus_1', deletedAt: new Date() }];
		selectResultQueue = [[], [{ id: 'r1' }, { id: 'r2' }]];

		await deactivateUser('u1', { actor: 'staff' });

		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'user.deactivated',
			subject: { type: 'user', id: 'u1', label: 'Jordan' },
			details: { reservationsCancelled: 2, subscriptionCancelled: true, bulk: false }
		});
	});

	it('does not claim a subscription was cancelled when Stripe refused', async () => {
		updateResult = [{ id: 'u1', name: 'Jordan', stripeId: 'cus_1', deletedAt: new Date() }];
		selectResultQueue = [[], []];
		subCancelMock.mockRejectedValueOnce(new Error('no such subscription'));

		await deactivateUser('u1', { actor: 'staff' });

		expect(recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				details: expect.objectContaining({ subscriptionCancelled: false })
			})
		);
	});

	it('writes one row per member in a bulk deactivation, sharing a batch id', async () => {
		updateResult = [{ id: 'x', name: 'X', deletedAt: new Date() }];
		selectResultQueue = [[], [], [], []];

		await deactivateUsers(['u1', 'u2']);

		expect(recordAuditEntry).toHaveBeenCalledTimes(2);
		const [a, b] = recordAuditEntry.mock.calls.map(
			([e]) => (e as { details: { bulk: boolean; batchId?: string } }).details
		);
		expect(a.bulk).toBe(true);
		expect(a.batchId).toBeTruthy();
		expect(b.batchId).toBe(a.batchId);
	});

	it('records nothing when the deactivation found no account', async () => {
		updateResult = [];
		await expect(deactivateUser('u1', { actor: 'staff' })).rejects.toThrow();
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});

	it('records a reactivation with the subscription outcome', async () => {
		updateResult = [{ id: 'u1', name: 'Jordan', stripeId: 'cus_1', deletedAt: null }];
		getSubscriptionMock.mockResolvedValueOnce(null);

		await reactivateUser('u1');

		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'user.reactivated',
			subject: { type: 'user', id: 'u1', label: 'Jordan' },
			details: { subscription: 'lapsed' }
		});
	});

	it('records a purge with the name and email, since nothing else survives it', async () => {
		selectResultQueue = [
			[{ id: 'u1', name: 'Jordan', email: 'j@example.com', deletedAt: new Date() }],
			[{ value: 0 }]
		];

		await purgeUser('u1');

		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'user.purged',
			subject: { type: 'user', id: 'u1', label: 'Jordan' },
			details: { name: 'Jordan', email: 'j@example.com' }
		});
	});

	it('records no purge that was refused', async () => {
		selectResultQueue = [[{ id: 'u1', name: 'J', email: 'j@x', deletedAt: null }]];
		await expect(purgeUser('u1')).rejects.toThrow();
		expect(recordAuditEntry).not.toHaveBeenCalled();
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
