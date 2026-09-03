import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The band packing list.
 *
 * Five things are worth pinning, and they are the five a reader cannot check by
 * eye:
 *
 * - **Editing a row neither unpacks it nor un-delegates it.** The save is a
 *   diff, not the rider's delete-and-reinsert, precisely because these rows
 *   carry `packed`, `assignedUserId` and `promotedAt` — state nobody typed. The
 *   assertions here are on the update payload's *keys*, because the failure mode
 *   is a stray key in a `.set()` rather than a wrong value.
 * - **A member's save cannot reach another member's rows**, even though drafts
 *   now carry ids. The ids are checked against an owner-scoped read and rejected
 *   rather than adopted.
 * - **Owning and carrying are different facts.** `claimItem` writes the guard's
 *   user and takes no assignee; `assignItem` is the separate admin path.
 * - **A claim is a race.** The write carries its own `IS NULL` predicate, so a
 *   claim on a taken row affects nothing and says so.
 * - **A reset clears ticks and leaves assignments alone.** Two verbs, two
 *   lifetimes; "clear everything" is the intuitive and wrong reading.
 */

let selectResults: unknown[][] = [];
let updateResults: unknown[][] = [];
let inserts: { table: unknown; values: unknown }[] = [];
let deletes: unknown[] = [];
let updates: Record<string, unknown>[] = [];
let batches: number[] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(queue());
			}
			return () => proxy;
		}
	});
	return proxy;
}

const next = () => (selectResults.length > 0 ? selectResults.shift()! : []);
const nextUpdate = () => (updateResults.length > 0 ? updateResults.shift()! : []);

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(next)),
		insert: vi.fn((table: unknown) => ({
			values: (values: unknown) => {
				inserts.push({ table, values });
				return chain(() => [{ id: 'list-1' }]);
			}
		})),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updates.push(values);
				return chain(nextUpdate);
			}
		})),
		delete: vi.fn((table: unknown) => ({
			where: (condition: unknown) => {
				deletes.push({ table, condition });
				return chain(() => []);
			}
		})),
		batch: vi.fn(async (statements: unknown[]) => {
			batches.push(statements.length);
			return Promise.all(statements as Promise<unknown>[]);
		})
	}
}));

const { packingItem } = await import('$lib/server/db/schema/packing');
const {
	compareItems,
	getPackingList,
	saveOwnItems,
	saveItemsFor,
	claimItem,
	releaseItem,
	assignItem,
	setPacked,
	resetPacked,
	PackingTooLargeError,
	PackingItemNotFoundError,
	PackingAlreadyClaimedError
} = await import('./packing-service');
const { PACKING_MAX_ITEMS, PACKING_MAX_QUANTITY } = await import('$lib/config');

const HEAD = {
	id: 'list-1',
	groupId: 'band-1',
	notes: null,
	lastResetAt: null,
	lastResetByUserId: null
};

/** A stored row as the owner-scoped read returns it. */
const stored = (id: string) => ({ id });

beforeEach(() => {
	selectResults = [];
	updateResults = [];
	inserts = [];
	deletes = [];
	updates = [];
	batches = [];
});

describe('compareItems', () => {
	const row = (category: string, sortOrder: number, label: string) =>
		({ category, sortOrder, label }) as Parameters<typeof compareItems>[0];

	it('groups by category, not by sortOrder', () => {
		// Backline is declared before merch, so it sorts first even though the
		// merch row holds the lower tie-break. If `sortOrder` were the spine, two
		// members who each have a row at position 0 would interleave by whoever
		// saved last.
		const merch = row('merch', 0, 'Merch tub');
		const backline = row('backline', 7, 'PA tub');
		expect([merch, backline].sort(compareItems)[0]).toBe(backline);
	});

	it('falls back to sortOrder within one category, then to the label', () => {
		const a = row('audio', 0, 'Zed');
		const b = row('audio', 1, 'Aardvark');
		expect([b, a].sort(compareItems)).toEqual([a, b]);

		const c = row('audio', 2, 'Alpha');
		const d = row('audio', 2, 'Beta');
		expect([d, c].sort(compareItems)).toEqual([c, d]);
	});
});

describe('getPackingList', () => {
	it('creates nothing when the band has never saved', async () => {
		selectResults = [[]];
		const view = await getPackingList('band-1');
		expect(view.id).toBeNull();
		expect(view.items).toEqual([]);
		expect(inserts).toEqual([]);
		expect(updates).toEqual([]);
	});

	it('counts what is packed and what nobody has', async () => {
		selectResults = [
			[HEAD],
			[
				{
					...stored('a'),
					assignedUserId: 'u-1',
					packed: true,
					category: 'audio',
					sortOrder: 0,
					label: 'A'
				},
				{
					...stored('b'),
					assignedUserId: null,
					packed: false,
					category: 'audio',
					sortOrder: 1,
					label: 'B'
				},
				{
					...stored('c'),
					assignedUserId: null,
					packed: true,
					category: 'audio',
					sortOrder: 2,
					label: 'C'
				}
			]
		];
		const view = await getPackingList('band-1');
		expect(view.itemCount).toBe(3);
		expect(view.packedCount).toBe(2);
		expect(view.unassignedCount).toBe(2);
	});
});

describe('saveOwnItems', () => {
	it('rejects a draft naming a row the owner does not have, and writes nothing', async () => {
		selectResults = [[HEAD], [stored('mine-1')]];
		await expect(
			saveOwnItems('band-1', 'u-1', [{ id: 'someone-elses', category: 'audio', label: 'DI box' }])
		).rejects.toThrow(PackingItemNotFoundError);
		expect(updates).toEqual([]);
		expect(inserts).toEqual([]);
		expect(deletes).toEqual([]);
	});

	it('updates only what the member typed — never packed, assignment or promotion', async () => {
		selectResults = [[HEAD], [stored('item-1')]];
		await saveOwnItems('band-1', 'u-1', [
			{ id: 'item-1', category: 'backline', label: 'Fender Twin', quantity: 2 }
		]);

		// The row update, not the `touch()` that follows it.
		const [row] = updates;
		expect(Object.keys(row).sort()).toEqual([
			'category',
			'label',
			'notes',
			'quantity',
			'riderKind',
			'sortOrder'
		]);
		// Stated separately from the key list so the intent survives a reordering
		// of it: renaming a thing must not empty the van or drop whoever agreed
		// to carry it.
		expect(row).not.toHaveProperty('packed');
		expect(row).not.toHaveProperty('assignedUserId');
		expect(row).not.toHaveProperty('promotedAt');
		expect(row).not.toHaveProperty('userId');
	});

	it('re-derives sortOrder from array position, ignoring anything submitted', async () => {
		selectResults = [[HEAD], [stored('a'), stored('b')]];
		await saveOwnItems('band-1', 'u-1', [
			{ id: 'b', category: 'audio', label: 'Second' },
			{ id: 'a', category: 'audio', label: 'First' }
		]);
		expect(updates[0]).toMatchObject({ label: 'Second', sortOrder: 0 });
		expect(updates[1]).toMatchObject({ label: 'First', sortOrder: 1 });
	});

	it('inserts new rows against the caller, and deletes the ones left out', async () => {
		selectResults = [[HEAD], [stored('keep'), stored('drop')]];
		await saveOwnItems('band-1', 'u-1', [
			{ id: 'keep', category: 'audio', label: 'Keep' },
			{ category: 'merch', label: 'New tub' }
		]);

		expect(deletes).toHaveLength(1);
		const [insert] = inserts;
		expect(insert.table).toBe(packingItem);
		expect(insert.values).toEqual([
			expect.objectContaining({ label: 'New tub', listId: 'list-1', userId: 'u-1', sortOrder: 1 })
		]);
	});

	it('clamps a silly quantity rather than letting the CHECK constraint reject it', async () => {
		selectResults = [[HEAD], []];
		await saveOwnItems('band-1', 'u-1', [
			{ category: 'audio', label: 'Cables', quantity: PACKING_MAX_QUANTITY + 500 }
		]);
		expect(inserts[0].values).toEqual([
			expect.objectContaining({ quantity: PACKING_MAX_QUANTITY })
		]);
	});

	it('refuses an oversized payload before it runs a single query', async () => {
		const many = Array.from({ length: PACKING_MAX_ITEMS + 1 }, (_, i) => ({
			category: 'other' as const,
			label: `Thing ${i}`
		}));
		await expect(saveOwnItems('band-1', 'u-1', many)).rejects.toThrow(PackingTooLargeError);
		expect(selectResults).toHaveLength(0);
		expect(inserts).toEqual([]);
	});
});

describe('saveItemsFor', () => {
	it('refuses to park a crate on somebody who is not on the roster', async () => {
		selectResults = [[]];
		await expect(
			saveItemsFor('band-1', 'stranger', [{ category: 'other', label: 'Anything' }])
		).rejects.toThrow(PackingItemNotFoundError);
		expect(inserts).toEqual([]);
	});

	it('writes the band’s shared crate when the owner is null', async () => {
		selectResults = [[HEAD], []];
		await saveItemsFor('band-1', null, [{ category: 'merch', label: 'Merch tub' }]);
		expect(inserts[0].values).toEqual([
			expect.objectContaining({ label: 'Merch tub', userId: null })
		]);
	});
});

describe('claiming', () => {
	it('writes the caller, not a payload — claimItem takes no assignee at all', async () => {
		selectResults = [[HEAD], [stored('item-1')]];
		updateResults = [[{ id: 'item-1' }]];
		await claimItem('band-1', 'u-1', 'item-1');

		expect(updates[0]).toMatchObject({ assignedUserId: 'u-1', assignedByUserId: 'u-1' });
		// A claim is not a change to what the band brings, so it must not bump
		// `updatedAt` — that would remount every open editor on the page.
		expect(updates).toHaveLength(1);
	});

	it('loses the race rather than overwriting the first claim', async () => {
		selectResults = [[HEAD], [stored('item-1')]];
		// The conditional update matched nothing: somebody claimed it in between.
		updateResults = [[]];
		await expect(claimItem('band-1', 'u-2', 'item-1')).rejects.toThrow(PackingAlreadyClaimedError);
	});

	it('releases only the caller’s own assignment', async () => {
		selectResults = [[HEAD], [stored('item-1')]];
		updateResults = [[]];
		await expect(releaseItem('band-1', 'not-the-assignee', 'item-1')).rejects.toThrow(
			PackingItemNotFoundError
		);
	});

	it('records who handed a row out, separately from who is carrying it', async () => {
		selectResults = [[HEAD], [stored('item-1')], [{ id: 'm-1' }]];
		await assignItem('band-1', 'admin-1', 'item-1', 'u-2');
		expect(updates[0]).toMatchObject({ assignedUserId: 'u-2', assignedByUserId: 'admin-1' });
	});

	it('will not hand a row to somebody who has left the band', async () => {
		selectResults = [[HEAD], [stored('item-1')], []];
		await expect(assignItem('band-1', 'admin-1', 'item-1', 'departed')).rejects.toThrow(
			PackingItemNotFoundError
		);
		expect(updates).toEqual([]);
	});

	it('unassigns without needing a roster check', async () => {
		selectResults = [[HEAD], [stored('item-1')]];
		await assignItem('band-1', 'admin-1', 'item-1', null);
		expect(updates[0]).toMatchObject({ assignedUserId: null, assignedByUserId: null });
	});
});

describe('packing', () => {
	it('lets anybody tick anything, and records who did', async () => {
		// The caller owns nothing here and is not the assignee. That is allowed on
		// purpose — one person walks the list at load-out — and it is the rule a
		// later reader would "fix" back to the rider's.
		selectResults = [[HEAD], [stored('someone-elses-amp')]];
		await setPacked('band-1', 'whoever', 'someone-elses-amp', true);
		expect(updates[0]).toMatchObject({ packed: true, packedByUserId: 'whoever' });
	});

	it('clears the packer when it is unticked', async () => {
		selectResults = [[HEAD], [stored('item-1')]];
		await setPacked('band-1', 'u-1', 'item-1', false);
		expect(updates[0]).toMatchObject({ packed: false, packedAt: null, packedByUserId: null });
	});

	it('refuses a row that is not on this band’s list', async () => {
		selectResults = [[HEAD], []];
		await expect(setPacked('band-1', 'u-1', 'other-bands-item', true)).rejects.toThrow(
			PackingItemNotFoundError
		);
		expect(updates).toEqual([]);
	});
});

describe('resetPacked', () => {
	it('clears ticks and stamps the head in one batch', async () => {
		selectResults = [[HEAD]];
		updateResults = [[{ id: 'a' }, { id: 'b' }]];
		const result = await resetPacked('band-1', 'u-1');

		expect(batches).toEqual([2]);
		expect(result.cleared).toBe(2);
		expect(updates[0]).toMatchObject({ packed: false, packedAt: null, packedByUserId: null });
		expect(updates[1]).toMatchObject({ lastResetByUserId: 'u-1' });
	});

	it('leaves the assignments alone — ticks are per-trip, who carries what is not', async () => {
		selectResults = [[HEAD]];
		updateResults = [[]];
		await resetPacked('band-1', 'u-1');

		const [clear] = updates;
		expect(Object.keys(clear).sort()).toEqual(['packed', 'packedAt', 'packedByUserId']);
		expect(clear).not.toHaveProperty('assignedUserId');
		expect(clear).not.toHaveProperty('assignedByUserId');
	});

	it('does nothing at all on a band with no list', async () => {
		selectResults = [[]];
		const result = await resetPacked('band-1', 'u-1');
		expect(result.cleared).toBe(0);
		expect(batches).toEqual([]);
		expect(updates).toEqual([]);
	});
});
