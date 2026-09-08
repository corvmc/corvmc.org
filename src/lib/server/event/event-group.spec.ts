import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The `event_group` invariant: every write that sets `event.groupId` also writes
 * the managing group's own row.
 *
 * It matters because the read side is allowed to assume it. `event_group` is
 * "whose page does this appear on", and the managing group missing from its own
 * event's list would force every such read to branch on "sometimes present,
 * sometimes not" — which is exactly the branch the spec added the automatic row
 * to avoid. Nothing in the database enforces this, so it is enforced here.
 *
 * Its own file rather than a block in `event-service.spec.ts`: that spec's
 * insert mock returns `{ returning }` and nothing else, which cannot carry an
 * `onConflictDoNothing` chain, and widening it would change what every other
 * test in it is standing on.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Every insert, by table name, so a test asserts on rows rather than calls. */
let inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
let selectQueue: unknown[][] = [];

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

vi.mock('$lib/server/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/db')>();
	return {
		...actual,
		db: {
			select: () => chainable(),
			insert: (table: unknown) => ({
				values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
					const rows = Array.isArray(v) ? v : [v];
					inserts.push({ table: tableName(table), rows });
					const chain = {
						onConflictDoNothing: () => chain,
						returning: (cols?: Record<string, unknown>) =>
							Promise.resolve(
								rows.map((r, i) => (cols ? { id: `evt-${i}` } : { id: `evt-${i}`, ...r }))
							),
						then: (resolve: (v: unknown) => void) => resolve(undefined)
					};
					return chain;
				}
			}),
			update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
			delete: () => ({ where: () => Promise.resolve() })
		}
	};
});

vi.mock('$lib/server/storage', () => ({ uploadImage: vi.fn(), deleteObject: vi.fn() }));
vi.mock('$lib/server/media/media-service', () => ({
	attachToSlot: vi.fn(),
	detachSlot: vi.fn()
}));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const { createBandEvent, importBandEvents } = await import('./event-service');

function rowsFor(table: string) {
	return inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
}

beforeEach(() => {
	vi.clearAllMocks();
	inserts = [];
	selectQueue = [];
});

// ---------------------------------------------------------------------------

describe('createBandEvent', () => {
	it('writes the managing group its own event_group row', async () => {
		// The owner-name lookup the lineup invariant makes.
		selectQueue = [[{ name: 'The Squares' }]];

		await createBandEvent({
			bandId: 'band-1',
			createdByUserId: 'user-1',
			title: 'Basement Show',
			startsAt: new Date('2026-09-01T02:00:00Z')
		});

		expect(rowsFor('event_group')).toEqual([
			// sortOrder 0 — the managing group heads the list, co-hosts follow.
			{ eventId: 'evt-0', groupId: 'band-1', sortOrder: 0 }
		]);
	});

	it('sets the owner on `groupId`, not on a column that no longer exists', async () => {
		selectQueue = [[{ name: 'The Squares' }]];

		await createBandEvent({
			bandId: 'band-1',
			createdByUserId: 'user-1',
			title: 'Basement Show',
			startsAt: new Date('2026-09-01T02:00:00Z')
		});

		const [evt] = rowsFor('event_listing');
		expect(evt.groupId).toBe('band-1');
		expect(evt).not.toHaveProperty('bandId');
	});
});

describe('importBandEvents', () => {
	/**
	 * The path where a stale key was silent. These values are built through
	 * `.map()`, so TypeScript's excess-property check does not apply — a leftover
	 * `bandId` would have been dropped by drizzle and every imported gig would
	 * have had no owner at all, with nothing failing.
	 */
	it('gives every imported gig an owner and an event_group row', async () => {
		selectQueue = [[{ name: 'The Squares' }]];

		await importBandEvents('band-1', 'user-1', [
			{ title: 'Gig One', startsAt: new Date('2026-01-01T02:00:00Z') },
			{ title: 'Gig Two', startsAt: new Date('2026-02-01T02:00:00Z') }
		]);

		for (const evt of rowsFor('event_listing')) {
			expect(evt.groupId).toBe('band-1');
		}
		expect(rowsFor('event_group')).toHaveLength(2);
		for (const link of rowsFor('event_group')) {
			expect(link.groupId).toBe('band-1');
		}
	});
});
