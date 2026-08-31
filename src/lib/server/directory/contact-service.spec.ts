import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The private contact table's guarantees.
 *
 * `contact` holds booking details for people who are not CMC members — a
 * manager's phone number, a settlement reference. Three rules protect it, and
 * each is asserted here rather than trusted:
 *
 *   1. every export guards with `requireStaff()` *itself*, so the guard travels
 *      with the data instead of belonging to whoever calls it;
 *   2. writing a contact registers the address in the consent ledger and
 *      **never** enrols it in an audience;
 *   3. claiming an act archives the contact rather than inheriting it.
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

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable(),
		insert: (table: unknown) => ({
			values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
				const rows = Array.isArray(v) ? v : [v];
				inserts.push({ table: tableName(table), rows });
				return {
					returning: () => Promise.resolve(rows.map((r) => ({ id: 'sub-new', ...r }))),
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

const requireStaff = vi.fn(async () => ({ id: 'staff-1' }));
vi.mock('$lib/server/authorization', () => ({
	requireStaff: (...a: unknown[]) => requireStaff(...(a as []))
}));

const {
	getContact,
	upsertContact,
	writeContactUnguarded,
	archiveContactForClaim,
	listExpiredContacts,
	hasContact
} = await import('./contact-service');

function rowsFor(table: string) {
	return inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
}

beforeEach(() => {
	vi.clearAllMocks();
	inserts = [];
	updates = [];
	selectQueue = [];
	requireStaff.mockResolvedValue({ id: 'staff-1' });
});

// ---------------------------------------------------------------------------

describe('the guard travels with the data', () => {
	/**
	 * Not "the callers guard" — the exports do. A guard the caller owns is a
	 * guard a new caller can forget, and this is the table where forgetting it
	 * means publishing somebody's phone number.
	 */
	it.each([
		['getContact', () => getContact('de-1')],
		['upsertContact', () => upsertContact('de-1', {}, 'staff_entered')],
		['listExpiredContacts', () => listExpiredContacts()],
		['hasContact', () => hasContact('de-1')]
	])('%s calls requireStaff itself', async (_name, run) => {
		await run();
		expect(requireStaff).toHaveBeenCalled();
	});

	it('refuses to read when the staff guard throws', async () => {
		requireStaff.mockRejectedValue(new Error('403'));
		await expect(getContact('de-1')).rejects.toThrow('403');
	});

	/**
	 * The one deliberate exception, and it is named so that reaching for it looks
	 * like what it is. `/act/{token}` is authorized by a token rather than a
	 * session — the act filling in its own sheet has no account, and
	 * `requireStaff()` would refuse the acquisition path the spec calls the
	 * privacy-best one.
	 */
	it('exempts only the token path, and says so in its name', async () => {
		await writeContactUnguarded('de-1', { bookingName: 'A Manager' }, 'self_entered');
		expect(requireStaff).not.toHaveBeenCalled();
		expect(rowsFor('contact')[0]).toMatchObject({ source: 'self_entered' });
	});
});

describe('the consent ledger', () => {
	it('registers the address as a subscriber', async () => {
		selectQueue = [[], []]; // no existing subscriber, no existing contact

		await upsertContact('de-1', { bookingEmail: 'Manager@Example.COM' }, 'staff_entered');

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
		selectQueue = [[], []];

		await upsertContact('de-1', { bookingEmail: 'manager@example.com' }, 'staff_entered');

		expect(rowsFor('audience_member')).toHaveLength(0);
	});

	/**
	 * Reused, not duplicated — `subscriber.email` is unique, and reusing the row
	 * is what carries an existing suppression forward rather than minting a
	 * fresh deliverable one.
	 */
	it('reuses an address already in the ledger, suppression and all', async () => {
		selectQueue = [[{ id: 'sub-existing' }], []];

		await upsertContact('de-1', { bookingEmail: 'manager@example.com' }, 'staff_entered');

		expect(rowsFor('subscriber')).toHaveLength(0);
		expect(rowsFor('contact')[0]).toMatchObject({ subscriberId: 'sub-existing' });
	});

	it('registers nothing when no email was given', async () => {
		selectQueue = [[]];

		await upsertContact('de-1', { bookingPhone: '555-0100' }, 'staff_entered');

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
	it('stamps a retention horizon rather than deleting the record', async () => {
		await archiveContactForClaim('de-1');

		const [write] = updates.filter((u) => u.table === 'contact');
		expect(write.values.retainUntil).toBeInstanceOf(Date);
	});

	/**
	 * No staff guard, deliberately: this runs inside `claimExternalAct`, which is
	 * already staff-guarded at its own boundary, and a second guard there would
	 * be a guard on a guard rather than on the data.
	 */
	it('does not re-guard inside an already-guarded claim', async () => {
		await archiveContactForClaim('de-1');
		expect(requireStaff).not.toHaveBeenCalled();
	});
});
