import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// Same shape as the volunteering specs: a chainable proxy that records the
// calls, so the assertions can be about the predicate a query built rather than
// about whatever a stub was told to return. `better-sqlite3` is not built in
// CI, so only `$lib/server/db` is mocked.
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
let chainCalls: { method: string; args: unknown[] }[] = [];
let batchCalls: unknown[][] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			}
			return (...args: unknown[]) => {
				chainCalls.push({ method: String(prop), args });
				return proxy;
			};
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => chainable()),
		update: vi.fn(() => chainable()),
		delete: vi.fn(() => chainable()),
		batch: vi.fn(async (stmts: unknown[]) => {
			batchCalls.push(stmts);
			return [];
		})
	}
}));

vi.mock('$lib/server/utils/slug', () => ({
	generateSlug: (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
	ensureUniqueSlug: vi.fn(async (base: string) => base)
}));

import {
	archiveVenue,
	deleteVenue,
	holdsSpace,
	setPrimaryVenue,
	updateVenue,
	VenueInUseError,
	PrimaryVenueError
} from './venue-service';
import { ensureUniqueSlug } from '$lib/server/utils/slug';

function venueRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'venue-1',
		name: 'The Practice Room',
		slug: 'the-practice-room',
		isPrimary: false,
		deletedAt: null,
		...overrides
	};
}

/** The object handed to `.set()` — what the UPDATE actually writes. */
function updatedColumns() {
	const set = chainCalls.find((c) => c.method === 'set');
	expect(set, 'expected an update').toBeDefined();
	return set!.args[0] as Record<string, unknown>;
}

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [];
	chainCalls = [];
	batchCalls = [];
});

describe('holdsSpace', () => {
	/**
	 * The rule the whole table exists for, and the one that has to be wrong in
	 * the safe direction. Every event created before `venue` has a null
	 * `venue_id`, and every one of them was in the room — so an absent venue must
	 * read as ours. Reading it as off-site would silently stop holding the space
	 * for shows that have always held it.
	 */
	it('reads an event with no venue as being in our room', async () => {
		expect(await holdsSpace(null)).toBe(true);
		expect(await holdsSpace(undefined)).toBe(true);
		expect(await holdsSpace('')).toBe(true);
	});

	it('holds the space for the primary venue', async () => {
		selectResult = [{ isPrimary: true }];
		expect(await holdsSpace('venue-1')).toBe(true);
	});

	it('holds nothing for anywhere else', async () => {
		selectResult = [{ isPrimary: false }];
		expect(await holdsSpace('venue-2')).toBe(false);
	});

	/** A dangling id is a bug, not a reason to stop holding a room. */
	it('falls back to our room when the venue has gone', async () => {
		selectResult = [];
		expect(await holdsSpace('venue-gone')).toBe(true);
	});
});

describe('setPrimaryVenue', () => {
	/**
	 * The unique partial index means the clear has to land before the set, or the
	 * second write trips it. D1 has no interactive transactions, so this is a
	 * `db.batch` — and the order inside it is the whole correctness argument.
	 */
	it('clears the old room before setting the new one, in one batch', async () => {
		selectResult = [venueRow({ id: 'venue-2', isPrimary: false })];

		await setPrimaryVenue('venue-2');

		expect(batchCalls).toHaveLength(1);
		expect(batchCalls[0]).toHaveLength(2);

		const sets = chainCalls.filter((c) => c.method === 'set').map((c) => c.args[0] as any);
		expect(sets[0].isPrimary).toBe(false);
		expect(sets[1].isPrimary).toBe(true);
	});

	it('does nothing when it is already the room', async () => {
		selectResult = [venueRow({ isPrimary: true })];

		await setPrimaryVenue('venue-1');

		expect(batchCalls).toHaveLength(0);
	});

	it('refuses an archived venue, which would leave us with no room', async () => {
		selectResult = [venueRow({ deletedAt: new Date() })];

		await expect(setPrimaryVenue('venue-1')).rejects.toThrow(PrimaryVenueError);
	});
});

describe('archiveVenue', () => {
	it('refuses the room, since nothing would be left holding space', async () => {
		selectResult = [venueRow({ isPrimary: true })];

		await expect(archiveVenue('venue-1')).rejects.toThrow(PrimaryVenueError);
	});

	it('soft-deletes anywhere else', async () => {
		selectResult = [venueRow()];

		await archiveVenue('venue-1');

		expect(updatedColumns().deletedAt).toBeInstanceOf(Date);
	});
});

describe('deleteVenue', () => {
	/**
	 * Delete is for a row that should never have existed. Once an event names one,
	 * archiving is the honest answer — the same bargain `deleteEvent` makes once a
	 * ticket exists.
	 */
	it('refuses once an event names it', async () => {
		// Both reads — the venue lookup and the usage count — draw from the same
		// stub, so one row carries what each of them needs: not the primary room,
		// and named by three events.
		selectResult = [{ ...venueRow(), n: 3 }];

		await expect(deleteVenue('venue-1')).rejects.toThrow(VenueInUseError);
	});

	it('refuses the room outright', async () => {
		selectResult = [venueRow({ isPrimary: true })];

		await expect(deleteVenue('venue-1')).rejects.toThrow(PrimaryVenueError);
	});
});

describe('updateVenue', () => {
	/**
	 * Without the exclusion, every save that touches the name rotates the slug —
	 * 'whiteside-theatre' becomes 'whiteside-theatre-2' — and breaks every inbound
	 * link. The helper takes an exclusion for exactly this; the regression is
	 * forgetting to pass it.
	 */
	it('re-slugs only when the name moved, and excludes its own row', async () => {
		selectResult = [venueRow({ name: 'Old Name' })];

		await updateVenue('venue-1', { name: 'New Name' });

		expect(ensureUniqueSlug).toHaveBeenCalledOnce();
		const exclude = vi.mocked(ensureUniqueSlug).mock.calls[0][3];
		expect(exclude).toBeDefined();
		expect((exclude as { value: string }).value).toBe('venue-1');
	});

	it('leaves the slug alone when the name did not change', async () => {
		selectResult = [venueRow({ name: 'Same Name' })];

		await updateVenue('venue-1', { name: 'Same Name', city: 'Corvallis' });

		expect(ensureUniqueSlug).not.toHaveBeenCalled();
		expect('slug' in updatedColumns()).toBe(false);
	});
});
