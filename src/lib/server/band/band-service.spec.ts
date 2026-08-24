import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockBand = {
	id: 'band-1',
	name: 'The Velvet Underground',
	slug: 'the-velvet-underground',
	bio: 'NYC band',
	ownerId: 'user-owner',
	avatarKey: null,
	createdAt: new Date(),
	updatedAt: new Date()
};

const mockMember = {
	id: 'member-1',
	bandId: 'band-1',
	userId: 'user-2',
	role: 'member',
	position: 'Guitar',
	status: 'pending',
	invitedById: 'user-owner',
	createdAt: new Date()
};

let selectResult: unknown[] = [];
let selectResultQueue: unknown[][] = [];
let deleteResult = { rowCount: 1 };
let deleteReturning: unknown[] = [{ id: 'member-1' }];
let insertError: Error | null = null;
/**
 * What `create()` / `transferOwnership()` actually wrote, so a test can assert
 * on the rows rather than on the fact that `db.batch` was called at all.
 * Ownership lives in two places, and "batch was invoked" is exactly the
 * assertion that would still pass if the owner row went missing.
 */
let writes: { table: string; op: 'insert' | 'update'; values: Record<string, unknown> }[] = [];

/** Drizzle stores a table's name under a well-known symbol. */
function tableName(table: unknown): string {
	if (!table || typeof table !== 'object') return 'unknown';
	const sym = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
	return sym ? String((table as Record<symbol, unknown>)[sym]) : 'unknown';
}

function chainable(result?: unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (result !== undefined) return resolve(result);
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable(),
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((values: Record<string, unknown>) => {
				writes.push({ table: tableName(table), op: 'insert', values });
				return {
					returning: vi.fn(() => {
						if (insertError) return Promise.reject(insertError);
						return Promise.resolve([{ ...mockMember }]);
					})
				};
			})
		})),
		update: vi.fn((table: unknown) => ({
			set: vi.fn((values: Record<string, unknown>) => {
				writes.push({ table: tableName(table), op: 'update', values });
				return {
					where: vi.fn(() => ({
						returning: vi.fn(() => Promise.resolve([{ ...mockBand }]))
					}))
				};
			})
		})),
		delete: vi.fn(() => ({
			// Awaitable directly (revokeInvitation) or via .returning()
			// (declineInvitation, which needs the deleted-row count).
			where: vi.fn(() => ({
				returning: vi.fn(() => Promise.resolve(deleteReturning)),
				then: (resolve: (v: unknown) => void) => resolve(deleteResult)
			}))
		})),
		batch: vi.fn(() => Promise.resolve([]))
	}
}));

vi.mock('$lib/server/utils/slug', () => ({
	generateSlug: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9-]+/g, '')),
	ensureUniqueSlug: vi.fn(async (slug: string) => slug)
}));

vi.mock('$lib/server/reservation/reservation-service', () => ({
	cancel: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/storage', () => ({
	deleteObject: vi.fn().mockResolvedValue(undefined),
	uploadFile: vi.fn(async (_buffer: ArrayBuffer, key: string) => key)
}));

import {
	create,
	update,
	deleteBand,
	invite,
	acceptInvitation,
	declineInvitation,
	revokeInvitation,
	removeMember,
	updateMember,
	transferOwnership,
	leaveBand,
	getUserRole,
	setBandAvatar,
	clearBandAvatar,
	setTier,
	BandTierManagedByStripeError,
	BandMemberExistsError,
	CannotRemoveOwnerError,
	OwnerCannotLeaveError,
	BandNotFoundError
} from './band-service';
import { db } from '$lib/server/db';
import { generateSlug, ensureUniqueSlug } from '$lib/server/utils/slug';
import { cancel as cancelReservation } from '$lib/server/reservation/reservation-service';
import { deleteObject, uploadFile } from '$lib/server/storage';

// Walk a drizzle SQL condition (real `and`/`eq` operators — only `db` is
// mocked) and collect the column names it references, so tests can assert a
// WHERE clause is band-scoped without a real database.
function collectColumnNames(condition: unknown): string[] {
	const names: string[] = [];
	const visit = (node: unknown) => {
		if (!node || typeof node !== 'object') return;
		const record = node as Record<string, unknown>;
		if (typeof record.name === 'string' && record.table) names.push(record.name);
		if (Array.isArray(record.queryChunks)) record.queryChunks.forEach(visit);
	};
	visit(condition);
	return names;
}

describe('BandService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectResult = [];
		selectResultQueue = [];
		deleteResult = { rowCount: 1 };
		insertError = null;
		writes = [];
	});

	// -----------------------------------------------------------------------
	// create
	// -----------------------------------------------------------------------

	describe('create', () => {
		it('creates a band and owner membership via batch', async () => {
			selectResult = [{ ...mockBand }];
			const { db } = await import('$lib/server/db');
			const result = await create('user-owner', {
				name: 'The Velvet Underground',
				bio: 'NYC band'
			});

			expect(generateSlug).toHaveBeenCalledWith('The Velvet Underground');
			expect(ensureUniqueSlug).toHaveBeenCalled();
			expect(db.batch).toHaveBeenCalled();
			expect(result.id).toBe('band-1');
		});

		// Regression: `band.name` carried a UNIQUE constraint in the deployed DB
		// while `create()` inserted the name raw, so a second band with a name
		// already taken — including one held by a soft-deleted band, since
		// `deactivate()` only sets `deletedAt` and never frees the name — threw a
		// raw D1 "UNIQUE constraint failed: band.name" straight out of `db.batch`
		// and surfaced as a 500. Two bands may share a name; only the slug is
		// unique, which `ensureUniqueSlug` already guarantees by suffixing.
		it('allows a second band to reuse an existing name', async () => {
			selectResult = [{ ...mockBand }];
			vi.mocked(ensureUniqueSlug).mockResolvedValueOnce('the-velvet-underground-2');

			const result = await create('user-owner', { name: 'The Velvet Underground' });

			expect(result).toBeDefined();
			expect(ensureUniqueSlug).toHaveBeenCalled();
		});

		// `update()` guards the same case at its `returning()` call; `create()` read
		// `newBand.slug` in the caller (bands.remote.ts) off an unchecked
		// destructure, so an empty re-select surfaced as
		// "Cannot read properties of undefined" instead of a real error.
		it('throws BandNotFoundError when the post-insert re-select comes back empty', async () => {
			selectResult = [];

			await expect(create('user-owner', { name: 'Ghost Band' })).rejects.toThrow(BandNotFoundError);
		});

		// Ownership is recorded twice — `band.ownerId` and a `band_member` row with
		// role 'owner' — and only the member row is read by the guards
		// (`requireBandOwner` resolves through `requireBandMember()`). A band
		// created with just the column has no owner in practice: no address
		// change, no delete, no transfer, no subscription, no Settings nav. That
		// is what the Postgres migrator did to 5 of 16 production bands, so the
		// one path that gets it right is worth pinning to the rows it writes,
		// not merely to the fact that `db.batch` was called.
		it('writes exactly one active owner member row agreeing with band.ownerId', async () => {
			selectResult = [{ ...mockBand }];

			await create('user-owner', { name: 'The Velvet Underground' });

			const bandRows = writes.filter((w) => w.table === 'band' && w.op === 'insert');
			const ownerRows = writes.filter(
				(w) => w.table === 'band_member' && w.op === 'insert' && w.values.role === 'owner'
			);

			expect(bandRows).toHaveLength(1);
			expect(ownerRows).toHaveLength(1);
			expect(ownerRows[0].values.userId).toBe(bandRows[0].values.ownerId);
			expect(ownerRows[0].values.userId).toBe('user-owner');
			expect(ownerRows[0].values.status).toBe('active');
			expect(ownerRows[0].values.bandId).toBe(bandRows[0].values.id);
		});
	});

	// -----------------------------------------------------------------------
	// update
	// -----------------------------------------------------------------------

	describe('update', () => {
		// The slug is the band's public address — {slug}.corvmc.org, the directory
		// profile, every bookmark. Deriving it from the name meant a rename moved
		// all of it silently. Only `changeBandSlug` moves an address now.
		it('never touches the slug when the name changes', async () => {
			const { db } = await import('$lib/server/db');

			await update('band-1', { name: 'New Name' });

			expect(generateSlug).not.toHaveBeenCalled();
			expect(ensureUniqueSlug).not.toHaveBeenCalled();
			const setArg = vi.mocked(db.update).mock.results[0]?.value.set.mock.calls[0][0];
			expect(setArg).not.toHaveProperty('slug');
			expect(setArg).toMatchObject({ name: 'New Name' });
		});

		it('throws when band not found', async () => {
			const { db } = await import('$lib/server/db');
			vi.mocked(db.update).mockReturnValueOnce({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(() => Promise.resolve([]))
					}))
				}))
			} as any);

			await expect(update('band-999', { bio: 'test' })).rejects.toThrow(BandNotFoundError);
		});
	});

	// -----------------------------------------------------------------------
	// deleteBand
	// -----------------------------------------------------------------------

	describe('deleteBand', () => {
		it('cancels future reservations and deletes band', async () => {
			selectResultQueue = [
				[{ ...mockBand, avatarKey: 'bands/avatars/band-1.jpg' }], // getById
				[{ id: 'res-1' }, { id: 'res-2' }] // future reservations
			];

			await deleteBand('band-1');

			expect(cancelReservation).toHaveBeenCalledTimes(2);
			expect(deleteObject).toHaveBeenCalledWith('bands/avatars/band-1.jpg');
		});

		it('skips avatar delete when no avatar', async () => {
			selectResultQueue = [
				[{ ...mockBand, avatarKey: null }],
				[] // no future reservations
			];

			await deleteBand('band-1');

			expect(deleteObject).not.toHaveBeenCalled();
		});

		it('throws when band not found', async () => {
			selectResult = [];

			await expect(deleteBand('band-999')).rejects.toThrow(BandNotFoundError);
		});
	});

	// -----------------------------------------------------------------------
	// invite
	// -----------------------------------------------------------------------

	describe('invite', () => {
		it('creates a pending band member row', async () => {
			const result = await invite('band-1', 'user-2', 'member', 'Guitar', 'user-owner');

			expect(result.status).toBe('pending');
		});

		// The real D1 message. The old test fabricated a lowercase one, which is
		// why the case-sensitive `.includes('unique')` guard looked covered while
		// letting the raw D1_ERROR escape in production (JAVASCRIPT-SVELTEKIT-2D).
		it('throws BandMemberExistsError on the real D1 unique-violation message', async () => {
			insertError = new Error(
				'D1_ERROR: UNIQUE constraint failed: band_member.band_id, band_member.user_id: SQLITE_CONSTRAINT'
			);

			await expect(invite('band-1', 'user-2', 'member', null, 'user-owner')).rejects.toThrow(
				BandMemberExistsError
			);
		});

		it('unwraps a DrizzleQueryError that carries the driver message in cause', async () => {
			const wrapped = new Error('Failed query: insert into "band_member" ...');
			(wrapped as { cause?: unknown }).cause = new Error(
				'UNIQUE constraint failed: band_member.band_id, band_member.user_id'
			);
			insertError = wrapped;

			await expect(invite('band-1', 'user-2', 'member', null, 'user-owner')).rejects.toThrow(
				BandMemberExistsError
			);
		});
	});

	// -----------------------------------------------------------------------
	// acceptInvitation
	// -----------------------------------------------------------------------

	describe('acceptInvitation', () => {
		/**
		 * JAVASCRIPT-SVELTEKIT-2A. The old signature took a `band_member.id`, but
		 * the invite list only ever knows the band id, so the predicate matched
		 * nothing and every accept threw. These tests drive the id the UI really
		 * sends — a band id.
		 */
		function mockUpdateReturning(rows: unknown[]) {
			return {
				set: vi.fn(() => ({
					where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(rows)) }))
				}))
			} as any;
		}

		it('activates the pending row for a band id', async () => {
			const { db } = await import('$lib/server/db');
			vi.mocked(db.update).mockReturnValueOnce(
				mockUpdateReturning([{ ...mockMember, status: 'active', bandId: 'band-1' }])
			);

			const result = await acceptInvitation('band-1', 'user-2');

			expect(result).toEqual({ status: 'accepted', bandId: 'band-1' });
		});

		it('is idempotent when the invite was already accepted', async () => {
			const { db } = await import('$lib/server/db');
			vi.mocked(db.update).mockReturnValueOnce(mockUpdateReturning([]));
			selectResultQueue = [[{ status: 'active' }]];

			const result = await acceptInvitation('band-1', 'user-2');

			expect(result).toEqual({ status: 'already_active' });
		});

		it('reports not_found when there is no membership row at all', async () => {
			const { db } = await import('$lib/server/db');
			vi.mocked(db.update).mockReturnValueOnce(mockUpdateReturning([]));
			selectResultQueue = [[]];

			const result = await acceptInvitation('band-999', 'user-2');

			expect(result).toEqual({ status: 'not_found' });
		});
	});

	// -----------------------------------------------------------------------
	// declineInvitation / revokeInvitation
	// -----------------------------------------------------------------------

	describe('declineInvitation', () => {
		it('reports true when a pending row was removed', async () => {
			const { db } = await import('$lib/server/db');
			deleteReturning = [{ id: 'member-1' }];

			await expect(declineInvitation('band-1', 'user-2')).resolves.toBe(true);
			expect(db.delete).toHaveBeenCalled();
		});

		// Previously the delete result was discarded, so the UI toasted
		// "Invitation declined" even when nothing matched.
		it('reports false when nothing matched', async () => {
			deleteReturning = [];

			await expect(declineInvitation('band-1', 'user-2')).resolves.toBe(false);
		});
	});

	describe('revokeInvitation', () => {
		it('deletes the pending member row', async () => {
			const { db } = await import('$lib/server/db');
			await revokeInvitation('member-1');
			expect(db.delete).toHaveBeenCalled();
		});

		it('scopes the delete to the given band', async () => {
			const { db } = await import('$lib/server/db');
			await revokeInvitation('member-1', 'band-1');
			const condition = (db.delete as any).mock.results[0].value.where.mock.calls[0][0];
			expect(collectColumnNames(condition)).toContain('band_id');
		});
	});

	// -----------------------------------------------------------------------
	// removeMember
	// -----------------------------------------------------------------------

	describe('removeMember', () => {
		it('deletes an active member row', async () => {
			selectResult = [{ role: 'member' }];
			const { db } = await import('$lib/server/db');

			await removeMember('member-1');
			expect(db.delete).toHaveBeenCalled();
		});

		it('throws CannotRemoveOwnerError when removing owner', async () => {
			selectResult = [{ role: 'owner' }];

			await expect(removeMember('member-1')).rejects.toThrow(CannotRemoveOwnerError);
		});

		it('throws when member not found', async () => {
			selectResult = [];

			await expect(removeMember('member-999')).rejects.toThrow('Member not found');
		});

		// Regression (cross-band IDOR): a band admin's memberId comes from the
		// client, so band-context callers pass their band id and the row must be
		// invisible when it belongs to another band.
		it('treats a memberId from another band as not found when scoped', async () => {
			selectResult = []; // the band-scoped lookup finds nothing
			const { db } = await import('$lib/server/db');

			await expect(removeMember('other-bands-member', 'band-1')).rejects.toThrow(
				'Member not found'
			);
			expect(db.delete).not.toHaveBeenCalled();
		});

		it('scopes the delete to the given band', async () => {
			selectResult = [{ role: 'member' }];
			const { db } = await import('$lib/server/db');

			await removeMember('member-1', 'band-1');
			const condition = (db.delete as any).mock.results[0].value.where.mock.calls[0][0];
			expect(collectColumnNames(condition)).toContain('band_id');
		});
	});

	// -----------------------------------------------------------------------
	// updateMember
	// -----------------------------------------------------------------------

	describe('updateMember', () => {
		it('updates role and position', async () => {
			selectResult = [{ role: 'member' }];

			await expect(
				updateMember('member-1', { role: 'admin', position: 'Bass' })
			).resolves.not.toThrow();
		});

		it('throws CannotRemoveOwnerError when updating owner', async () => {
			selectResult = [{ role: 'owner' }];

			await expect(updateMember('member-1', { role: 'member' })).rejects.toThrow(
				CannotRemoveOwnerError
			);
		});

		// Regression (cross-band IDOR): see removeMember above.
		it('treats a memberId from another band as not found when scoped', async () => {
			selectResult = [];
			const { db } = await import('$lib/server/db');

			await expect(updateMember('other-bands-member', { role: 'admin' }, 'band-1')).rejects.toThrow(
				'Member not found'
			);
			expect(db.update).not.toHaveBeenCalled();
		});

		it('scopes the update to the given band', async () => {
			selectResult = [{ role: 'member' }];
			const { db } = await import('$lib/server/db');

			await updateMember('member-1', { role: 'admin' }, 'band-1');
			const setResult = (db.update as any).mock.results[0].value.set.mock.results[0].value;
			const condition = setResult.where.mock.calls[0][0];
			expect(collectColumnNames(condition)).toContain('band_id');
		});
	});

	// -----------------------------------------------------------------------
	// transferOwnership
	// -----------------------------------------------------------------------

	describe('transferOwnership', () => {
		it('demotes old owner and promotes new one via batch', async () => {
			selectResult = [{ status: 'active' }];
			const { db } = await import('$lib/server/db');
			await transferOwnership('band-1', 'user-2', 'user-owner');

			expect(db.batch).toHaveBeenCalled();
		});

		it('throws when new owner is not an active member', async () => {
			selectResult = [{ status: 'pending' }];
			await expect(transferOwnership('band-1', 'user-2', 'user-owner')).rejects.toThrow(
				'New owner must be an active band member'
			);
		});

		it('throws when new owner is not a band member', async () => {
			selectResult = [];
			await expect(transferOwnership('band-1', 'user-2', 'user-owner')).rejects.toThrow(
				'New owner must be an active band member'
			);
		});

		// The transfer is the other way ownership can drift: the demote is scoped
		// by `actorId`, which the staff wrapper feeds from `band.ownerId`. If that
		// column and the member row ever disagreed, the demote would match nothing
		// and leave the band with two owner rows. Exactly one promote, exactly one
		// demote, and `band.ownerId` moved with them.
		it('leaves exactly one owner: one promote, one demote, and band.ownerId moved', async () => {
			selectResult = [{ status: 'active' }];

			await transferOwnership('band-1', 'user-2', 'user-owner');

			const memberWrites = writes.filter((w) => w.table === 'band_member' && w.op === 'update');
			const promotes = memberWrites.filter((w) => w.values.role === 'owner');
			const demotes = memberWrites.filter((w) => w.values.role === 'admin');
			const bandWrites = writes.filter((w) => w.table === 'band' && w.op === 'update');

			expect(promotes).toHaveLength(1);
			expect(demotes).toHaveLength(1);
			expect(bandWrites).toHaveLength(1);
			expect(bandWrites[0].values.ownerId).toBe('user-2');
		});
	});

	// -----------------------------------------------------------------------
	// leaveBand
	// -----------------------------------------------------------------------

	describe('leaveBand', () => {
		it('deletes the member row', async () => {
			selectResult = [{ role: 'member' }];
			const { db } = await import('$lib/server/db');

			await leaveBand('band-1', 'user-2');
			expect(db.delete).toHaveBeenCalled();
		});

		it('throws OwnerCannotLeaveError when owner tries to leave', async () => {
			selectResult = [{ role: 'owner' }];

			await expect(leaveBand('band-1', 'user-owner')).rejects.toThrow(OwnerCannotLeaveError);
		});

		it('throws when not a member', async () => {
			selectResult = [];

			await expect(leaveBand('band-1', 'user-999')).rejects.toThrow('Not a member');
		});
	});

	// -----------------------------------------------------------------------
	// getUserRole
	// -----------------------------------------------------------------------

	describe('getUserRole', () => {
		it('returns role for active member', async () => {
			selectResult = [{ role: 'admin', status: 'active' }];

			const role = await getUserRole('band-1', 'user-2');
			expect(role).toBe('admin');
		});

		it('returns null for non-member', async () => {
			selectResult = [];

			const role = await getUserRole('band-1', 'user-999');
			expect(role).toBeNull();
		});
	});

	describe('setBandAvatar', () => {
		it('uploads the file and returns a cache-busting, extension-mapped key', async () => {
			selectResult = [{ avatarKey: null }];

			const key = await setBandAvatar('band-1', new ArrayBuffer(8), 'image/png');

			// The per-upload token is what stops a replaced avatar reusing its URL.
			expect(key).toMatch(/^bands\/avatars\/band-1-[0-9a-f]{8}\.png$/);
			expect(uploadFile).toHaveBeenCalledWith(expect.any(ArrayBuffer), key, 'image/png');
		});

		it('deletes the previous avatar before replacing it', async () => {
			selectResult = [{ avatarKey: 'bands/avatars/band-1.jpg' }];

			await setBandAvatar('band-1', new ArrayBuffer(8), 'image/webp');

			expect(deleteObject).toHaveBeenCalledWith('bands/avatars/band-1.jpg');
			expect(uploadFile).toHaveBeenCalledWith(
				expect.any(ArrayBuffer),
				expect.stringMatching(/^bands\/avatars\/band-1-[0-9a-f]{8}\.webp$/),
				'image/webp'
			);
		});

		it('throws when the band does not exist', async () => {
			selectResult = [];

			await expect(setBandAvatar('nope', new ArrayBuffer(8), 'image/png')).rejects.toThrow(
				BandNotFoundError
			);
		});
	});

	describe('setTier', () => {
		it('comps premium on a band with no Stripe subscription', async () => {
			selectResult = [{ ...mockBand, tier: 'free', subscription: null }];

			await setTier('band-1', 'premium');

			const setArg = (db.update as any).mock.results[0].value.set.mock.calls[0][0];
			expect(setArg).toMatchObject({ tier: 'premium' });
		});

		it('refuses to touch a band billed through Stripe', async () => {
			selectResult = [
				{
					...mockBand,
					tier: 'premium',
					subscription: { stripeSubscriptionId: 'sub_123' }
				}
			];

			await expect(setTier('band-1', 'free')).rejects.toThrow(BandTierManagedByStripeError);
			expect(db.update).not.toHaveBeenCalled();
		});

		it('throws when the band does not exist', async () => {
			selectResult = [];

			await expect(setTier('nope', 'premium')).rejects.toThrow(BandNotFoundError);
		});
	});

	describe('clearBandAvatar', () => {
		it('deletes the stored object', async () => {
			selectResult = [{ avatarKey: 'bands/avatars/band-1.png' }];

			await clearBandAvatar('band-1');

			expect(deleteObject).toHaveBeenCalledWith('bands/avatars/band-1.png');
		});

		it('is a no-op delete when there is no avatar', async () => {
			selectResult = [{ avatarKey: null }];

			await clearBandAvatar('band-1');

			expect(deleteObject).not.toHaveBeenCalled();
		});
	});
});
