import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';

// ---------------------------------------------------------------------------
// Mocks
//
// Only `$lib/server/db` is mocked, so the drizzle operators (`and`, `eq`,
// `sql`) are the real ones and a test can inspect the conditions the service
// actually built. `$lib/server/storage` is mocked so the central rule of this
// module — nothing here deletes an R2 object — is assertable rather than
// assumed.
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
const writes: { table: string; values: Record<string, unknown> }[] = [];
const deletes: { table: string; where: unknown }[] = [];
let lastSelect: { where?: unknown; orderBy?: unknown } = {};

/** Drizzle stores a table's name under a well-known symbol. */
function tableName(table: unknown): string {
	if (!table || typeof table !== 'object') return 'unknown';
	const sym = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
	return sym ? String((table as Record<symbol, unknown>)[sym]) : 'unknown';
}

function selectChain() {
	const chain: Record<string, unknown> = {};
	const step = (fn?: (arg: unknown) => void) => (arg: unknown) => {
		fn?.(arg);
		return chain;
	};
	Object.assign(chain, {
		from: step(),
		innerJoin: step(),
		where: step((w) => (lastSelect.where = w)),
		orderBy: step((o) => (lastSelect.orderBy = o)),
		then: (resolve: (v: unknown[]) => void) => resolve(selectResult)
	});
	return chain;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => selectChain()),
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((values: Record<string, unknown>) => {
				writes.push({ table: tableName(table), values });
				return { returning: vi.fn(() => Promise.resolve([{ id: 'new-row', ...values }])) };
			})
		})),
		delete: vi.fn((table: unknown) => ({
			where: vi.fn((w: unknown) => {
				deletes.push({ table: tableName(table), where: w });
				return Promise.resolve(undefined);
			})
		}))
	}
}));

vi.mock('$lib/server/storage', () => ({
	deleteObject: vi.fn().mockResolvedValue(undefined),
	uploadFile: vi.fn()
}));

const {
	record,
	attach,
	detach,
	detachSlot,
	listFor,
	countAttachments,
	liveAttachmentCondition,
	totalLiveBytes
} = await import('./media-service');
const { deleteObject } = await import('$lib/server/storage');
const { db } = await import('$lib/server/db');
const { mediaAttachment } = await import('$lib/server/db/schema/media');

/** Walk a drizzle condition and collect the column names it references. */
function collectColumnNames(condition: unknown): string[] {
	const names: string[] = [];
	const visit = (node: unknown) => {
		if (!node || typeof node !== 'object') return;
		const n = node as Record<string, unknown>;
		if (typeof n.name === 'string' && n.table) names.push(n.name);
		for (const key of ['queryChunks', 'chunks', 'left', 'right', 'value']) {
			const child = n[key];
			if (Array.isArray(child)) child.forEach(visit);
			else if (child) visit(child);
		}
	};
	visit(condition);
	return names;
}

beforeEach(() => {
	writes.length = 0;
	deletes.length = 0;
	selectResult = [];
	lastSelect = {};
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe('record', () => {
	it('writes the object metadata a bare key column had nowhere to put', async () => {
		await record({
			key: 'events/posters/abc123.jpg',
			contentType: 'image/jpeg',
			byteSize: 4096,
			filename: 'poster.jpg',
			altText: 'A band on stage',
			uploadedByUserId: 'user-1'
		});

		expect(writes).toHaveLength(1);
		expect(writes[0].table).toBe('media');
		expect(writes[0].values).toMatchObject({
			key: 'events/posters/abc123.jpg',
			byteSize: 4096,
			altText: 'A band on stage',
			uploadedByUserId: 'user-1'
		});
	});

	it('records an object with no attachment, so the sweep can still find it', async () => {
		// This is the state `band_media` cannot represent: an object that exists
		// in R2 and is referenced by nothing. Recording it is what makes it
		// reclaimable rather than stranded.
		await record({ key: 'k', contentType: 'image/png', byteSize: 1 });

		expect(writes.map((w) => w.table)).toEqual(['media']);
		expect(deletes).toHaveLength(0);
	});
});

describe('attach', () => {
	it('lets two parents point at one object', async () => {
		await attach({
			mediaId: 'media-1',
			attachableType: 'event_listing',
			attachableId: 'event-1',
			slot: 'poster'
		});
		await attach({
			mediaId: 'media-1',
			attachableType: 'event_listing',
			attachableId: 'event-2',
			slot: 'poster'
		});

		expect(writes).toHaveLength(2);
		expect(writes.every((w) => w.table === 'media_attachment')).toBe(true);
		expect(writes.map((w) => w.values.mediaId)).toEqual(['media-1', 'media-1']);
		expect(writes.map((w) => w.values.attachableId)).toEqual(['event-1', 'event-2']);
	});

	it('defaults sortOrder so a single-image slot needs no caller ceremony', async () => {
		await attach({
			mediaId: 'media-1',
			attachableType: 'user',
			attachableId: 'user-1',
			slot: 'avatar'
		});
		expect(writes[0].values.sortOrder).toBe(0);
	});
});

describe('detach', () => {
	it('never deletes the R2 object', async () => {
		// The rule the whole module exists to hold. A sibling occurrence may still
		// be using this object, and only the sweep can see the whole graph.
		await detach('attachment-1');

		expect(deletes).toHaveLength(1);
		expect(deletes[0].table).toBe('media_attachment');
		expect(deleteObject).not.toHaveBeenCalled();
	});

	it('leaves the media row alone, so the object stays reachable', async () => {
		await detach('attachment-1');
		expect(deletes.map((d) => d.table)).not.toContain('media');
	});
});

describe('detachSlot', () => {
	it('scopes the delete to one parent and one slot', async () => {
		await detachSlot('group', 'group-1', 'avatar');

		expect(deletes).toHaveLength(1);
		const cols = collectColumnNames(deletes[0].where);
		expect(cols).toContain('attachable_type');
		expect(cols).toContain('attachable_id');
		expect(cols).toContain('slot');
		expect(deleteObject).not.toHaveBeenCalled();
	});
});

describe('listFor', () => {
	it('scopes to the parent, and to the slot when one is given', async () => {
		await listFor('event_listing', 'event-1', 'poster');

		const cols = collectColumnNames(lastSelect.where);
		expect(cols).toContain('attachable_type');
		expect(cols).toContain('attachable_id');
		expect(cols).toContain('slot');
	});

	it('omits the slot predicate when no slot is given', async () => {
		await listFor('event_listing', 'event-1');

		const cols = collectColumnNames(lastSelect.where);
		expect(cols).toContain('attachable_id');
		expect(cols).not.toContain('slot');
	});

	it('takes several slots in one statement', async () => {
		// The band microsite wants four slots and must not fan out four queries
		// for them — and must not take everything attached to the group either,
		// since the group's avatar is a media_attachment now too.
		await listFor('group', 'group-1', ['gallery', 'hero', 'stage_plot', 'rider']);

		const cols = collectColumnNames(lastSelect.where);
		expect(cols).toContain('attachable_id');
		expect(cols).toContain('slot');
		expect(db.select).toHaveBeenCalledOnce();
	});

	it('orders by sortOrder', async () => {
		await listFor('group', 'group-1', 'gallery');
		expect(lastSelect.orderBy).toBe(mediaAttachment.sortOrder);
	});
});

describe('countAttachments', () => {
	it('returns zero rather than undefined when nothing points at the object', async () => {
		// Zero is the sweep's reap signal, so it must never arrive as undefined.
		selectResult = [];
		expect(await countAttachments('media-1')).toBe(0);
	});

	it('coerces the driver’s count to a number', async () => {
		selectResult = [{ n: '3' }];
		expect(await countAttachments('media-1')).toBe(3);
	});
});

describe('liveAttachmentCondition', () => {
	// A bare drizzle instance renders SQL with no D1 binding.
	const renderDb = drizzle({} as never);

	it('excludes an orphan by testing each parent table', () => {
		const { sql: rendered } = renderDb
			.select({ id: mediaAttachment.id })
			.from(mediaAttachment)
			.where(liveAttachmentCondition())
			.toSQL();

		// One EXISTS arm per attachable type — a type with no arm would let its
		// orphans through silently, which is the failure this pins.
		expect(rendered).toContain('"event_listing"');
		expect(rendered).toContain('"group"');
		expect(rendered).toContain('"user"');
		expect(rendered.match(/exists/gi) ?? []).toHaveLength(3);
	});

	it('correlates each EXISTS to the outer attachment row', () => {
		const { sql: rendered } = renderDb
			.select({ id: mediaAttachment.id })
			.from(mediaAttachment)
			.where(liveAttachmentCondition())
			.toSQL();

		// Unqualified, the inner comparison would bind to the subquery's own table
		// and match every row — the correlated-subquery bug pinned in
		// correlated-sql.spec.ts, in a new place.
		expect(rendered).toContain('"media_attachment"."attachable_id"');
	});
});

describe('totalLiveBytes', () => {
	it('applies the live guard rather than summing the raw table', async () => {
		selectResult = [{ bytes: 2048 }];
		expect(await totalLiveBytes()).toBe(2048);
		expect(lastSelect.where).toBeDefined();
	});

	it('returns zero on an empty table', async () => {
		selectResult = [];
		expect(await totalLiveBytes()).toBe(0);
	});
});
