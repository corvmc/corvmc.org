import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * External acts — a `directory_entry` with **both** `userId` and `groupId` null.
 *
 * Two properties are worth pinning, and only one of them is about the new code.
 *
 * The first is that an external act is unreachable from anywhere public. It is a
 * staff-facing record and nothing else: no profile, no share link, no page
 * rendered to the world at any URL. That is the point of directory visibility
 * being a member benefit taken to its conclusion — CMC does not host a page for
 * a band that has no relationship with CMC.
 *
 * The second is that claiming one changes a single column. That is the whole
 * benefit of splitting the old `band` table by purpose: under the earlier
 * `band_profile` design the same step had to move name, description and avatar
 * between tables and null the originals.
 */

let inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
let updates: { table: string; values: Record<string, unknown> }[] = [];
let selectQueue: unknown[][] = [];
let batched: unknown[] = [];

function tableName(table: unknown): string {
	if (!table || typeof table !== 'object') return 'unknown';
	const sym = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
	return sym ? String((table as Record<symbol, unknown>)[sym]) : 'unknown';
}

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) =>
					resolve(selectQueue.length > 0 ? selectQueue.shift()! : []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable(),
		insert: (table: unknown) => ({
			values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
				const rows = Array.isArray(v) ? v : [v];
				inserts.push({ table: tableName(table), rows });
				return {
					returning: () => Promise.resolve(rows.map((r) => ({ id: 'entry-new', ...r }))),
					then: (resolve: (v: unknown) => void) => resolve(undefined)
				};
			}
		}),
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => {
				updates.push({ table: tableName(table), values });
				return { where: () => ({ then: (r: (v: unknown) => void) => r(undefined) }) };
			}
		}),
		delete: () => ({ where: () => ({ then: (r: (v: unknown) => void) => r(undefined) }) }),
		batch: (statements: unknown[]) => {
			batched = statements;
			return Promise.resolve(statements.map(() => []));
		}
	}
}));

vi.mock('$lib/server/utils/slug', () => ({
	generateSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
	ensureUniqueSlug: async (base: string) => base
}));
vi.mock('$lib/server/band/band-site-service', () => ({
	bandSiteInsert: () => ({ __bandSite: true })
}));

const { createExternalAct, claimExternalAct, ActAlreadyClaimedError, ExternalActNotFoundError } =
	await import('./entry-service');

function rowsFor(table: string) {
	return inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
}

beforeEach(() => {
	vi.clearAllMocks();
	inserts = [];
	updates = [];
	selectQueue = [];
	batched = [];
});

// ---------------------------------------------------------------------------

describe('createExternalAct', () => {
	it('leaves both owner columns null — that pair is what makes it external', async () => {
		await createExternalAct({ name: 'Touring Act' });

		const [entry] = rowsFor('directory_entry');
		expect(entry.userId).toBeNull();
		expect(entry.groupId).toBeNull();
	});

	/**
	 * Forced, not defaulted. Taking visibility as a parameter would make `hidden`
	 * something a caller could pass around — and a public external act is a CMC
	 * page for a band with no CMC relationship, which is the one thing the design
	 * says must not exist.
	 */
	it('forces the entry hidden', async () => {
		await createExternalAct({ name: 'Touring Act' });
		expect(rowsFor('directory_entry')[0].visibility).toBe('hidden');
	});

	it('creates no group and no roster row', async () => {
		await createExternalAct({ name: 'Touring Act' });
		expect(rowsFor('group')).toHaveLength(0);
		expect(rowsFor('group_member')).toHaveLength(0);
	});
});

describe('claimExternalAct', () => {
	const unowned = { id: 'de-1', name: 'Touring Act', userId: null, groupId: null };

	it('changes exactly one column on the entry', async () => {
		selectQueue = [[unowned]];

		await claimExternalAct('de-1', 'user-1');

		const entryUpdates = updates.filter((u) => u.table === 'directory_entry');
		expect(entryUpdates).toHaveLength(1);
		// Not name, not bio, not avatar — the act's own record is already right,
		// and its whole event history hangs off this row's id.
		expect(Object.keys(entryUpdates[0].values)).toEqual(['groupId']);
	});

	it('creates the band and its owner in one batch', async () => {
		selectQueue = [[unowned]];

		await claimExternalAct('de-1', 'user-1');

		expect(rowsFor('group')[0]).toMatchObject({ kind: 'band', name: 'Touring Act' });
		expect(rowsFor('group_member')[0]).toMatchObject({
			userId: 'user-1',
			role: 'owner',
			status: 'active'
		});
		// One batch, so a half-claimed act — a group with no owner, or an entry
		// pointing at a group that was never written — cannot exist.
		expect(batched.length).toBeGreaterThan(0);
	});

	/**
	 * The entry keeps `hidden`. It is a member band's listing now and theirs to
	 * publish, but publishing is their decision on their own profile rather than
	 * a side effect of somebody claiming.
	 */
	it("does not publish the listing on the band's behalf", async () => {
		selectQueue = [[unowned]];

		await claimExternalAct('de-1', 'user-1');

		const entryUpdates = updates.filter((u) => u.table === 'directory_entry');
		expect(entryUpdates[0].values).not.toHaveProperty('visibility');
	});

	it('refuses an entry that already belongs to a band', async () => {
		selectQueue = [[{ ...unowned, groupId: 'group-9' }]];

		await expect(claimExternalAct('de-1', 'user-1')).rejects.toBeInstanceOf(ActAlreadyClaimedError);
	});

	it('refuses an entry that belongs to a member', async () => {
		selectQueue = [[{ ...unowned, userId: 'user-9' }]];

		await expect(claimExternalAct('de-1', 'user-1')).rejects.toBeInstanceOf(ActAlreadyClaimedError);
	});

	it('404s an entry that is not there', async () => {
		selectQueue = [[]];

		await expect(claimExternalAct('de-nope', 'user-1')).rejects.toBeInstanceOf(
			ExternalActNotFoundError
		);
	});
});
