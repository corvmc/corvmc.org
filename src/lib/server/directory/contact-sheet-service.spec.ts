import { describe, it, expect, vi, beforeEach } from 'vitest';
import { positionOrder, type Capability, type Position } from '#lib/config.js';

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
let batches: number[] = [];

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
		}),
		// The statements were recorded as they were built; the batch only runs them.
		batch: async (statements: unknown[]) => {
			batches.push(statements.length);
			return [];
		}
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
		}
	};
});

const writeActContactUnguarded = vi.fn(async () => {});
vi.mock('./contact-service', () => ({
	writeActContactUnguarded: (...a: unknown[]) => writeActContactUnguarded(...(a as []))
}));
vi.mock('#lib/server/party/organization-service.js', () => ({
	performerFor: async (entryId: string) => `org-of-${entryId}`
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
	batches = [];
	heldPositions = ['staff'];
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
		expect(guard).not.toHaveBeenCalled();
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
		expect(writeActContactUnguarded).not.toHaveBeenCalled();
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

	it("writes the person on the act's performer organization", async () => {
		selectQueue = [[live()]];

		await saveContactSheet('tok', { contact: { email: 'a@b.test' } });

		expect(writeActContactUnguarded).toHaveBeenCalledWith(
			'org-of-de-1',
			expect.objectContaining({ email: 'a@b.test' })
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
	it('requires directory.shareContactSheet in both directions', async () => {
		await issueContactSheetLink('de-1', 'a@b.test', 'staff-1');
		await revokeContactSheetLink('de-1');
		expect(guard.mock.calls).toEqual([
			['directory.shareContactSheet'],
			['directory.shareContactSheet']
		]);
	});

	// The only caller, `contact-sheet.remote.ts`, already names this capability,
	// so every combination of positions gets what it got before this guard moved.
	it('admits exactly the shareContactSheet holders, and refuses the rest with 403', async () => {
		const subsets = Array.from({ length: 2 ** positionOrder.length }, (_, mask) =>
			positionOrder.filter((_, i) => mask & (1 << i))
		);
		for (const held of subsets) {
			heldPositions = held;
			const sharer = held.includes('admin') || held.includes('staff');
			for (const run of [
				() => issueContactSheetLink('de-1', 'a@b.test', 'staff-1'),
				() => revokeContactSheetLink('de-1')
			]) {
				const outcome = await run().then(
					() => 'allowed',
					(e: { status: number }) => e.status
				);
				expect(outcome, held.join('+')).toBe(sharer ? 'allowed' : 403);
			}
		}
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

	// #2781: "Link sent" answered with nothing sent. The email is now an outbox
	// row committed with the link, so a link cannot exist without its send.
	it('emails the link it issues, in the same batch as the link', async () => {
		selectQueue = [[{ name: 'Touring Act' }]];
		const { token, url, outboxId } = await issueContactSheetLink('de-1', 'A@B.test', 'staff-1');

		expect(batches).toEqual([3]);
		expect(inserts.map((i) => i.table)).toEqual(['directory_entry_link', 'outbox_message']);
		const mail = inserts[1].rows[0] as { id: string; payload: { to: string; model: object } };
		expect(mail.id).toBe(outboxId);
		expect(mail.payload.to).toBe('a@b.test');
		expect(url).toMatch(new RegExp(`/act/${token}$`));
		expect(JSON.stringify(mail.payload.model)).toContain(url);
	});

	it('gives the link a finite life', async () => {
		await issueContactSheetLink('de-1', 'a@b.test', 'staff-1');
		const { expiresAt } = inserts[0].rows[0] as { expiresAt: Date };
		expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
	});
});
