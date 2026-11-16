import { describe, it, expect, vi, beforeEach } from 'vitest';
import { positionOrder, type Capability, type Position } from '#lib/config.js';

/**
 * The private contact table's guarantees.
 *
 * `contact` holds booking details for people who are not CMC members — a
 * manager's phone number, a settlement reference. Three rules protect it, and
 * each is asserted here rather than trusted:
 *
 *   1. every export guards *itself*, so the guard travels with the data
 *      instead of belonging to whoever calls it;
 *   2. writing a contact registers the address in the consent ledger and
 *      **never** enrols it in an audience;
 *   3. claiming an act archives its people rather than inheriting them.
 *
 * The fourth rule — that no other module may import the table — is enforced by
 * `custom/no-contact-schema-imports` and asserted by `eslint-boundaries.spec.ts`,
 * because a lint rule is the only thing that can check a file that does not
 * exist yet.
 */

let inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
let updates: { table: string; values: Record<string, unknown> }[] = [];
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

vi.mock('#lib/server/db/index.js', () => ({
	db: {
		select: () => chainable(),
		insert: (table: unknown) => ({
			values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
				const rows = Array.isArray(v) ? v : [v];
				inserts.push({ table: tableName(table), rows });
				const returning = () => Promise.resolve(rows.map((r) => ({ id: 'sub-new', ...r })));
				return {
					returning,
					onConflictDoUpdate: () => ({ returning }),
					then: (resolve: (v: unknown) => void) => resolve(undefined)
				};
			}
		}),
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => {
				updates.push({ table: tableName(table), values });
				return { where: () => ({ then: (r: (v: unknown) => void) => r(undefined) }) };
			}
		})
	}
}));

// Guards are simulated against the real matrix. `guard` records which one ran.
let heldPositions: Position[] = ['staff'];
const guard = vi.fn((_name: string) => {});
vi.mock('#lib/server/authorization.js', async () => {
	const { error } = await import('@sveltejs/kit');
	const config = await import('#lib/config.js');
	return {
		requireCapability: async (cap: Capability) => {
			guard(cap);
			if (!heldPositions.some((p) => config.grantsCapability(config.positions[p], cap)))
				throw error(403, 'Not permitted');
			return { id: 'staff-1' };
		},
		// No project-scoped grants here: the bookers' path is covered on real SQLite.
		can: async () => false
	};
});

const { writeActContactUnguarded, archiveActContactsForClaim, listActContacts } =
	await import('./contact-service');

function rowsFor(table: string) {
	return inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
}

beforeEach(() => {
	vi.clearAllMocks();
	inserts = [];
	updates = [];
	selectQueue = [];
	heldPositions = ['staff'];
});

// ---------------------------------------------------------------------------

describe('the guard travels with the data', () => {
	/**
	 * Not "the callers guard" — the exports do. A guard the caller owns is a
	 * guard a new caller can forget, and this is the table where forgetting it
	 * means publishing somebody's phone number.
	 */
	const READS = [['listActContacts', () => listActContacts(['org-1'], null)]] as const;

	it.each(READS)('%s requires directory.readContact itself', async (_name, run) => {
		await run();
		expect(guard.mock.calls).toEqual([['directory.readContact']]);
	});

	it.each(READS)('%s refuses a treasurer with 403', async (_name, run) => {
		heldPositions = ['treasurer'];
		await expect(run()).rejects.toMatchObject({ status: 403 });
	});

	// Before: `requireStaff`, any position. After: the holders of
	// `directory.readContact` (admin, staff, volunteer coordinator), as #1390
	// intends. Every combination of the positions, including none.
	it.each(READS)('%s admits exactly the readContact holders', async (_name, run) => {
		const subsets = Array.from({ length: 2 ** positionOrder.length }, (_, mask) =>
			positionOrder.filter((_, i) => mask & (1 << i))
		);
		const narrowed: string[] = [];
		for (const held of subsets) {
			heldPositions = held;
			const allowed = await run().then(
				() => true,
				() => false
			);
			const reader = held.some((p) => ['admin', 'staff', 'volunteer_coordinator'].includes(p));
			expect(allowed, held.join('+')).toBe(reader);
			if (held.length > 0 && !allowed) narrowed.push(held.join('+'));
		}
		// Every non-empty mix of the positions that are not readers.
		expect(narrowed).toHaveLength(2 ** (positionOrder.length - 3) - 1);
	});

	/**
	 * The one deliberate exception, and it is named so that reaching for it looks
	 * like what it is. `/act/{token}` is authorized by a token rather than a
	 * session — the act filling in its own sheet has no account, and
	 * a session guard would refuse the acquisition path the spec calls the
	 * privacy-best one.
	 */
	it('exempts only the token path, and says so in its name', async () => {
		await writeActContactUnguarded('org-1', { name: 'A Manager' });
		expect(guard).not.toHaveBeenCalled();
		expect(rowsFor('contact')[0]).toMatchObject({ source: 'self_entered' });
	});
});

describe('the consent ledger', () => {
	it('registers the address as a subscriber', async () => {
		selectQueue = [[]]; // no existing contact

		await writeActContactUnguarded('org-1', { email: 'Manager@Example.COM' });

		expect(rowsFor('subscriber')[0]).toMatchObject({ email: 'manager@example.com' });
		expect(rowsFor('contact')[0]).toMatchObject({ subscriberId: 'sub-new' });
	});

	/**
	 * The rule the spec draws a line under. Registering an address is
	 * bookkeeping — it is what makes "may we email this person" have exactly one
	 * answer. Enrolling it in a list without opt-in is a different act, and it is
	 * how a sending domain collects spam complaints.
	 */
	it('never enrols that address in an audience', async () => {
		selectQueue = [[]];

		await writeActContactUnguarded('org-1', { email: 'manager@example.com' });

		expect(rowsFor('audience_member')).toHaveLength(0);
	});

	// Reuse of an address already in the ledger runs against real SQLite, in
	// get-or-create.spec.ts: it is the upsert on `subscriber.email` that does it.

	it('registers nothing when no email was given', async () => {
		selectQueue = [[]];

		await writeActContactUnguarded('org-1', { phone: '555-0100' });

		expect(rowsFor('subscriber')).toHaveLength(0);
		expect(rowsFor('contact')[0]).toMatchObject({ subscriberId: null });
	});
});

describe('archiving on claim', () => {
	/**
	 * Archived, not inherited. The booking contact is frequently a manager rather
	 * than one of the members who just joined, so carrying it forward would leave
	 * a member band holding a stale private number nobody owns.
	 */
	it('stamps a retention horizon a year out rather than deleting the record', async () => {
		const now = new Date('2026-11-12T12:00:00Z');
		await archiveActContactsForClaim('org-1', now);

		const [write] = updates.filter((u) => u.table === 'contact');
		expect(write.values.retainUntil).toEqual(new Date('2027-11-12T12:00:00Z'));
	});

	/**
	 * No staff guard, deliberately: this runs inside `claimExternalAct`, which is
	 * already staff-guarded at its own boundary, and a second guard there would
	 * be a guard on a guard rather than on the data.
	 */
	it('does not re-guard inside an already-guarded claim', async () => {
		await archiveActContactsForClaim('org-1');
		expect(guard).not.toHaveBeenCalled();
	});
});
