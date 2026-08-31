import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — records what the lineup writer inserts and deletes, and lets each
// test queue the rows a select resolves to.
// ---------------------------------------------------------------------------

let selectQueue: unknown[][] = [];
/** Every where() the call built — the confirmed filter lives in a subquery. */
const capturedWheres: unknown[] = [];
const insertedRows: Record<string, unknown>[][] = [];
let lastUpdateSet: Record<string, unknown> | null = null;

function chain(): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectQueue.shift() ?? []);
			}
			if (prop === 'where') {
				return (clause: unknown) => {
					capturedWheres.push(clause);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(),
		insert: () => ({
			values: (rows: Record<string, unknown>[] | Record<string, unknown>) => {
				insertedRows.push(Array.isArray(rows) ? rows : [rows]);
				return Promise.resolve();
			}
		}),
		update: () => ({
			set: (vals: Record<string, unknown>) => {
				lastUpdateSet = vals;
				return { where: () => Promise.resolve() };
			}
		}),
		delete: () => ({ where: () => Promise.resolve() })
	},
	getRowCount: () => 0
}));

vi.mock('$lib/server/reservation/reservation-service', () => ({
	staffCreate: vi.fn(),
	cancel: vi.fn(),
	ReservationConflictError: class extends Error {}
}));
vi.mock('$lib/server/reservation/conflict-service', () => ({ hasConflict: vi.fn() }));
const mockEmit = vi.fn();
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...a: unknown[]) => mockEmit(...a) }
}));
vi.mock('$lib/server/storage', () => ({ uploadFile: vi.fn(), deleteObject: vi.fn() }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

import {
	setEventLineup,
	confirmLineupSlot,
	declineLineupSlot,
	listBandEventsUpcoming,
	listBandEventsPast,
	countBandPastEvents,
	listMemberUpcomingShows
} from './event-service';

/** Depth-first search of a drizzle SQL tree for a bound parameter value. */
function containsParam(node: unknown, value: unknown): boolean {
	if (!node || typeof node !== 'object') return false;
	if ((node as { value?: unknown }).value === value) return true;
	const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
	return Array.isArray(chunks) && chunks.some((c) => containsParam(c, value));
}

const OWNER = 'band-owner';
const OTHER = 'band-other';

/** What those groups' `directory_entry` rows are, per `queueLineupState`. */
const OWNER_ENTRY = 'entry-owner';
const OTHER_ENTRY = 'entry-other';

/**
 * `groupId` is the event's owner.
 *
 * Two vocabularies below, deliberately. A `bandId` in a `setEventLineup` *input*
 * is a group — that is what a lineup editor picks. A stored credit names a
 * `directory_entry`, so assertions on written rows read `directoryEntryId`. The
 * service resolves one to the other, which is the whole of phase 10a.
 */
const ownedEvent = {
	id: 'evt-1',
	title: 'Basement Show',
	startsAt: new Date('2026-09-01T02:00:00Z'),
	groupId: OWNER
};

/** Queue: getById(event), then the existing event_band rows. */
/**
 * The selects `setEventLineup` makes, in order: the event, the existing credits,
 * then the group→entry lookup a credit needs to name a `directory_entry`.
 *
 * The third one is queued here rather than per test because it is unconditional
 * for any linked credit, and leaving it out silently shifts every later select
 * by one — which is how the notify query started reading the entry rows and the
 * invite email stopped being sent, with the write itself still correct.
 */
function queueLineupState(existing: unknown[] = []) {
	selectQueue = [
		[ownedEvent],
		// The entry lookup runs *before* the existing credits are read: matching an
		// incoming group against a stored credit goes through this map, so it has
		// to exist first.
		[
			{ groupId: OWNER, id: 'entry-owner' },
			{ groupId: OTHER, id: 'entry-other' }
		],
		existing
	];
}

/** The rows setEventLineup wrote, flattened across chunks. */
function writtenLineup() {
	return insertedRows.flat();
}

beforeEach(() => {
	selectQueue = [];
	capturedWheres.length = 0;
	insertedRows.length = 0;
	lastUpdateSet = null;
	mockEmit.mockClear();
});

describe('setEventLineup — status resolution', () => {
	it('stores a name with no band as an unlinked credit', async () => {
		queueLineupState();
		await setEventLineup('evt-1', [{ name: 'Paper Wolves', billingOrder: 0 }], {
			actingBandId: OWNER
		});

		expect(writtenLineup()).toEqual([
			expect.objectContaining({ name: 'Paper Wolves', directoryEntryId: null, status: 'unlinked' })
		]);
	});

	// The point of the unlinked state: most acts on a bill have no CMC account,
	// so listing them must not require one — and must not notify anybody.
	it('notifies nobody about an unlinked credit', async () => {
		queueLineupState();
		await setEventLineup('evt-1', [{ name: 'Paper Wolves', billingOrder: 0 }], {
			actingBandId: OWNER
		});

		expect(mockEmit).not.toHaveBeenCalled();
	});

	it('auto-confirms the acting band’s own slot', async () => {
		queueLineupState();
		await setEventLineup('evt-1', [{ name: 'Us', bandId: OWNER, billingOrder: 0 }], {
			actingBandId: OWNER
		});

		expect(writtenLineup()[0]).toMatchObject({
			directoryEntryId: OWNER_ENTRY,
			status: 'confirmed'
		});
	});

	it('leaves another band pending, and asks them', async () => {
		queueLineupState();
		// getById + existing rows, then notifyLineupInvites' owner + admin lookups.
		selectQueue.push([{ name: 'The Owners' }]);
		selectQueue.push([
			{
				bandId: OTHER,
				bandName: 'Paper Wolves',
				bandSlug: 'paper-wolves',
				userId: 'u1',
				userName: 'A',
				userEmail: 'a@example.com'
			}
		]);

		await setEventLineup('evt-1', [{ name: 'Paper Wolves', bandId: OTHER, billingOrder: 0 }], {
			actingBandId: OWNER
		});

		expect(writtenLineup()[0]).toMatchObject({ directoryEntryId: OTHER_ENTRY, status: 'pending' });

		await Promise.resolve();
		await Promise.resolve();
		expect(mockEmit).toHaveBeenCalledWith(
			'event.lineup_invited',
			expect.objectContaining({ invitedBandId: OTHER, eventId: 'evt-1' })
		);
	});

	it('confirms outright when staff set the bill', async () => {
		queueLineupState();
		await setEventLineup('evt-1', [{ name: 'Paper Wolves', bandId: OTHER, billingOrder: 0 }], {
			asStaff: true
		});

		expect(writtenLineup()[0]).toMatchObject({ status: 'confirmed' });
		expect(mockEmit).not.toHaveBeenCalled();
	});
});

describe('setEventLineup — existing rows', () => {
	it('keeps a confirmed act confirmed when the bill is reordered', async () => {
		queueLineupState([
			{
				id: 'eb-1',
				eventId: 'evt-1',
				name: 'Paper Wolves',
				directoryEntryId: OTHER_ENTRY,
				status: 'confirmed'
			}
		]);

		await setEventLineup(
			'evt-1',
			[
				{ name: 'Us', bandId: OWNER, billingOrder: 0 },
				{ name: 'Paper Wolves', bandId: OTHER, billingOrder: 1 }
			],
			{ actingBandId: OWNER }
		);

		const other = writtenLineup().find((r) => r.directoryEntryId === OTHER_ENTRY);
		expect(other).toMatchObject({ status: 'confirmed', billingOrder: 1 });
	});

	// The anti-nag rule. Without it, an owner could remove and re-add a band
	// that said no and generate a fresh invitation every time.
	it('never resurrects a declined act, and does not re-notify', async () => {
		queueLineupState([
			{
				id: 'eb-1',
				eventId: 'evt-1',
				name: 'Paper Wolves',
				directoryEntryId: OTHER_ENTRY,
				status: 'declined'
			}
		]);

		await setEventLineup('evt-1', [{ name: 'Paper Wolves', bandId: OTHER, billingOrder: 0 }], {
			actingBandId: OWNER
		});

		expect(writtenLineup()[0]).toMatchObject({ status: 'declined' });
		expect(mockEmit).not.toHaveBeenCalled();
	});

	it('keeps the owner on its own bill even when omitted', async () => {
		queueLineupState([
			{
				id: 'eb-0',
				eventId: 'evt-1',
				name: 'Us',
				directoryEntryId: OWNER_ENTRY,
				status: 'confirmed',
				note: null
			}
		]);

		await setEventLineup('evt-1', [{ name: 'Paper Wolves', billingOrder: 0 }], {
			actingBandId: OWNER
		});

		expect(writtenLineup().map((r) => r.directoryEntryId)).toContain(OWNER_ENTRY);
	});
});

describe('setEventLineup — validation', () => {
	it('refuses a bill longer than twelve acts', async () => {
		queueLineupState();
		const acts = Array.from({ length: 13 }, (_, i) => ({ name: `Act ${i}`, billingOrder: i }));

		await expect(setEventLineup('evt-1', acts, { actingBandId: OWNER })).rejects.toThrow(/12/);
	});

	it('collapses a band listed twice', async () => {
		queueLineupState();
		await setEventLineup(
			'evt-1',
			[
				{ name: 'Paper Wolves', bandId: OTHER, billingOrder: 0 },
				{ name: 'Paper Wolves (again)', bandId: OTHER, billingOrder: 1 }
			],
			{ asStaff: true }
		);

		expect(writtenLineup()).toHaveLength(1);
	});

	it('collapses the same name in different case', async () => {
		queueLineupState();
		await setEventLineup(
			'evt-1',
			[
				{ name: 'paper wolves', billingOrder: 0 },
				{ name: 'Paper Wolves', billingOrder: 1 }
			],
			{ actingBandId: OWNER }
		);

		expect(writtenLineup()).toHaveLength(1);
	});

	it('renumbers billing order to be contiguous', async () => {
		queueLineupState();
		await setEventLineup(
			'evt-1',
			[
				{ name: 'A', billingOrder: 5 },
				{ name: 'B', billingOrder: 9 }
			],
			{ actingBandId: OWNER }
		);

		expect(writtenLineup().map((r) => r.billingOrder)).toEqual([0, 1]);
	});
});

describe('confirm / decline', () => {
	it('confirming sets the slot confirmed', async () => {
		await confirmLineupSlot('evt-1', OTHER);
		expect(lastUpdateSet).toEqual({ status: 'confirmed' });
	});

	// Declining unlinks the band from the credit but leaves the owner's record
	// of their own show intact — the name still renders, just as plain text.
	it('declining sets declined rather than deleting the row', async () => {
		await declineLineupSlot('evt-1', OTHER);
		expect(lastUpdateSet).toEqual({ status: 'declined' });
	});
});

// ---------------------------------------------------------------------------
// The credit/consent boundary — the reason this design exists. A band must not
// be able to write to another band's profile by naming them on a bill.
// ---------------------------------------------------------------------------

describe('band-scoped reads only surface confirmed credits', () => {
	it.each([
		['listBandEventsUpcoming', () => listBandEventsUpcoming(OTHER)],
		['listBandEventsPast', () => listBandEventsPast(OTHER, { limit: 20, offset: 0 })],
		['countBandPastEvents', () => countBandPastEvents(OTHER)],
		['listMemberUpcomingShows', () => listMemberUpcomingShows('user-1')]
	])('%s filters on status = confirmed', async (_name, run) => {
		selectQueue = [[]];
		await run();

		const anyClause = (v: unknown) => capturedWheres.some((w) => containsParam(w, v));
		expect(anyClause('confirmed')).toBe(true);
		expect(anyClause('pending')).toBe(false);
		expect(anyClause('declined')).toBe(false);
	});
});
