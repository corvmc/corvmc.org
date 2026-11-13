import { describe, it, expect, vi, beforeEach } from 'vitest';

// `ensureAccount` against a real SQLite and the in-memory gateway, which
// replays an idempotency key as Stripe does (#2681). Two first calls both read
// no account; they must end with one Stripe account and one row, not an
// orphaned account and a primary-key error.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { gateway } = await vi.hoisted(async () => {
	const { createFakeGateway } = await import('#lib/server/finance/gateway/fake-gateway.js');
	return { gateway: createFakeGateway() };
});
const createAccount = vi.spyOn(gateway.accounts, 'create');
vi.mock('#lib/server/stripe.js', () => ({ stripe: gateway }));

const { ensureAccount } = await import('./connect-service');

beforeEach(() => {
	vi.clearAllMocks();
	sqlite.exec('delete from band_stripe_account');
	sqlite.exec('delete from "group"');
	sqlite.exec(`insert into "group" (id, kind, name, slug) values ('g1', 'band', 'Band', 'band')`);
});

describe('ensureAccount', () => {
	it('creates one account when two first calls overlap', async () => {
		const ids = await Promise.all([
			ensureAccount({ groupId: 'g1', bandName: 'Band' }),
			ensureAccount({ groupId: 'g1', bandName: 'Band' })
		]);

		const rows = sqlite.prepare('select stripe_account_id from band_stripe_account').all();
		expect(ids[1]).toBe(ids[0]);
		expect(rows).toEqual([{ stripe_account_id: ids[0] }]);
	});

	it('returns the stored account without asking Stripe again', async () => {
		const first = await ensureAccount({ groupId: 'g1', bandName: 'Band' });
		createAccount.mockClear();

		await expect(ensureAccount({ groupId: 'g1', bandName: 'Band' })).resolves.toBe(first);
		expect(createAccount).not.toHaveBeenCalled();
	});
});
