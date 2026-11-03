import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Premium used to bill the owner's personal Stripe customer, and a customer
 * cannot hold two subscriptions — so nobody could buy it (#1081). The band
 * gets a customer of its own, stored on its `band_site` row. Stripe is mocked;
 * the row is real SQLite.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const mockCreate = vi.fn(async (_args: unknown) => ({ id: 'cus_band' }));
vi.mock('#lib/server/stripe.js', () => ({
	stripe: { customers: { create: mockCreate } }
}));
vi.mock('#lib/server/finance/payment-service.js', () => ({ checkout: vi.fn() }));

const { ensureBandStripeCustomer, bandContactEmail } = await import('./band-subscription-service');

function site(groupId: string, stripeCustomerId: string | null = null) {
	sqlite
		.prepare('insert into band_site (id, group_id, stripe_customer_id) values (?, ?, ?)')
		.run(`site-${groupId}`, groupId, stripeCustomerId);
}

function directory(groupId: string, contact: unknown) {
	sqlite
		.prepare('insert into directory_entry (id, group_id, name, contact) values (?, ?, ?, ?)')
		.run(`dir-${groupId}`, groupId, groupId, contact === null ? null : JSON.stringify(contact));
}

const customerOf = (groupId: string) =>
	(
		sqlite
			.prepare('select stripe_customer_id as id from band_site where group_id = ?')
			.get(groupId) as { id: string | null } | undefined
	)?.id;

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of ['band_site', 'directory_entry']) sqlite.exec(`delete from ${t}`);
});

describe('the band’s own Stripe customer', () => {
	it('creates one against the band, not the owner, and stores it on that band', async () => {
		site('band-1');
		site('band-2');

		const id = await ensureBandStripeCustomer({
			bandId: 'band-1',
			bandName: 'Ninety Proof',
			email: 'book@ninetyproof.example'
		});

		expect(id).toBe('cus_band');
		expect(mockCreate).toHaveBeenCalledWith({
			name: 'Ninety Proof',
			email: 'book@ninetyproof.example',
			// Traceable from the Stripe dashboard, matching the Connect account's.
			metadata: { corvmc_group_id: 'band-1' }
		});
		expect(customerOf('band-1')).toBe('cus_band');
		expect(customerOf('band-2')).toBeNull();
	});

	it('reuses the one it already has', async () => {
		site('band-1', 'cus_existing');

		expect(
			await ensureBandStripeCustomer({
				bandId: 'band-1',
				bandName: 'Ninety Proof'
			})
		).toBe('cus_existing');
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('does not reuse another band’s customer', async () => {
		// The other band's row first, so a lookup that lost its WHERE would read it.
		site('band-2', 'cus_theirs');
		site('band-1');

		expect(
			await ensureBandStripeCustomer({
				bandId: 'band-1',
				bandName: 'Ninety Proof'
			})
		).toBe('cus_band');
		expect(customerOf('band-2')).toBe('cus_theirs');
	});

	it('creates one with no email rather than borrowing a personal address', async () => {
		site('band-1');

		await ensureBandStripeCustomer({
			bandId: 'band-1',
			bandName: 'Ninety Proof',
			email: null
		});

		expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ email: undefined }));
	});

	it('reads the act’s contact address off its own directory entry', async () => {
		directory('band-1', { email: 'book@ninetyproof.example' });
		directory('band-2', { email: 'other@example.com' });

		expect(await bandContactEmail('band-1')).toBe('book@ninetyproof.example');
	});

	it('returns null when the act has no contact address', async () => {
		directory('band-1', null);
		directory('band-2', { phone: '555' });

		expect(await bandContactEmail('band-1')).toBeNull();
		expect(await bandContactEmail('band-2')).toBeNull();
		expect(await bandContactEmail('no-entry')).toBeNull();
	});
});
