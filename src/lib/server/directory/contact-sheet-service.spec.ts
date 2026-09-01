import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The contact-sheet token — the only thing standing between a URL and one act's
 * record.
 *
 * There is no session anywhere in this path. The act has no account, so the
 * token *is* the authorization, and every property that makes it safe has to be
 * asserted rather than assumed: that it expires, that revoking it works
 * immediately, that an invalid one is indistinguishable from an unknown one, and
 * that holding it does not let somebody rename the act.
 */

let updates: { table: string; values: Record<string, unknown> }[] = [];
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

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable(),
		insert: (table: unknown) => ({
			values: (v: Record<string, unknown>) => {
				inserts.push({ table: tableName(table), rows: [v] });
				return {
					returning: () => Promise.resolve([{ token: 'tok-new', ...v }]),
					then: (r: (v: unknown) => void) => r(undefined)
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

const writeContactUnguarded = vi.fn(async () => {});
vi.mock('./contact-service', () => ({
	writeContactUnguarded: (...a: unknown[]) => writeContactUnguarded(...(a as []))
}));

const {
	issueContactSheetLink,
	revokeContactSheetLink,
	resolveContactSheetToken,
	saveContactSheet,
	ContactSheetLinkInvalidError
} = await import('./contact-sheet-service');

const HOUR = 3600_000;

function live(over: Record<string, unknown> = {}) {
	return {
		linkId: 'link-1',
		entryId: 'de-1',
		expiresAt: new Date(Date.now() + 24 * HOUR),
		revokedAt: null,
		name: 'Touring Act',
		bio: null,
		hometown: null,
		links: null,
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	updates = [];
	inserts = [];
	selectQueue = [];
	requireStaff.mockResolvedValue({ id: 'staff-1' });
});

// ---------------------------------------------------------------------------

describe('resolving a token', () => {
	it('accepts a live one', async () => {
		selectQueue = [[live()]];
		expect(await resolveContactSheetToken('tok')).toMatchObject({ entryId: 'de-1' });
	});

	/**
	 * All three answer `null`, identically. A response that distinguished
	 * "expired" from "never existed" would let somebody probe which tokens CMC
	 * once issued.
	 */
	it.each([
		['unknown', []],
		['revoked', [live({ revokedAt: new Date() })]],
		['expired', [live({ expiresAt: new Date(Date.now() - HOUR) })]]
	])('refuses a %s token, indistinguishably', async (_label, rows) => {
		selectQueue = [rows];
		expect(await resolveContactSheetToken('tok')).toBeNull();
	});

	it('consults no session', async () => {
		selectQueue = [[live()]];
		await resolveContactSheetToken('tok');
		// The act has no account. A staff guard here would refuse the only caller
		// this exists for.
		expect(requireStaff).not.toHaveBeenCalled();
	});
});

describe('saving a sheet', () => {
	it('re-resolves the token on every write', async () => {
		// Not "the caller already checked": a remote function takes its arguments
		// from a client-supplied payload, so a prior resolve is never something
		// this can assume.
		selectQueue = [[live({ revokedAt: new Date() })]];

		await expect(saveContactSheet('tok', { contact: {} })).rejects.toBeInstanceOf(
			ContactSheetLinkInvalidError
		);

		expect(updates.filter((u) => u.table === 'directory_entry')).toHaveLength(0);
		expect(writeContactUnguarded).not.toHaveBeenCalled();
	});

	/**
	 * The constraint that is structural rather than checked: `name` is not in
	 * `ContactSheetData` at all, so there is no value a caller could pass. Staff
	 * own the canonical name because it appears on posters and settlement records.
	 */
	it('never writes the name', async () => {
		selectQueue = [[live()]];

		await saveContactSheet('tok', { bio: 'We play loud', contact: {} });

		const [write] = updates.filter((u) => u.table === 'directory_entry');
		expect(write.values).not.toHaveProperty('name');
	});

	it('records the contact as self-entered', async () => {
		selectQueue = [[live()]];

		await saveContactSheet('tok', { contact: { bookingEmail: 'a@b.test' } });

		// The whole point of this path: CMC holds what the act chose to give,
		// rather than what staff transcribed.
		expect(writeContactUnguarded).toHaveBeenCalledWith(
			'de-1',
			expect.objectContaining({ bookingEmail: 'a@b.test' }),
			'self_entered'
		);
	});

	it('marks the link used only after the write succeeds', async () => {
		selectQueue = [[live()]];

		await saveContactSheet('tok', { contact: {} });

		const linkWrites = updates.filter((u) => u.table === 'directory_entry_link');
		expect(linkWrites.at(-1)?.values).toHaveProperty('lastUsedAt');
	});
});

describe('issuing and revoking', () => {
	it('is staff-only in both directions', async () => {
		await issueContactSheetLink('de-1', 'a@b.test', 'staff-1');
		expect(requireStaff).toHaveBeenCalled();

		requireStaff.mockClear();
		await revokeContactSheetLink('de-1');
		expect(requireStaff).toHaveBeenCalled();
	});

	/**
	 * Issuing revokes whatever was live first. Two live links would mean an
	 * address staff deliberately cut off could still be used by whoever holds the
	 * older one — the opposite of what revoking is for.
	 */
	it('retires any live link before issuing a new one', async () => {
		await issueContactSheetLink('de-1', 'a@b.test', 'staff-1');

		const revoke = updates.find((u) => u.table === 'directory_entry_link');
		expect(revoke?.values).toHaveProperty('revokedAt');
		expect(inserts.some((i) => i.table === 'directory_entry_link')).toBe(true);
	});

	it('normalizes the address it is valid for', async () => {
		await issueContactSheetLink('de-1', '  Manager@Example.COM ', 'staff-1');
		expect(inserts[0].rows[0]).toMatchObject({ email: 'manager@example.com' });
	});

	it('gives the link a finite life', async () => {
		await issueContactSheetLink('de-1', 'a@b.test', 'staff-1');
		const { expiresAt } = inserts[0].rows[0] as { expiresAt: Date };
		expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
	});
});
