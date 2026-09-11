import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Premium used to bill the owner's personal Stripe customer, and a customer
 * cannot hold two subscriptions — so an owner who already contributed was
 * refused by Stripe, and one who had not was refused by us before reaching
 * it. Nobody could buy it (#1081).
 */

const mockCreate = vi.fn();
vi.mock('$lib/server/stripe', () => ({ stripe: { customers: { create: mockCreate } } }));

let selectResult: unknown[] = [];
const setSpy = vi.fn();
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({ where: () => ({ limit: async () => selectResult }) })
		}),
		update: () => ({ set: (v: unknown) => (setSpy(v), { where: async () => undefined }) })
	}
}));

vi.mock('$lib/server/db/schema/band-site', () => ({
	bandSite: { groupId: 'groupId', stripeCustomerId: 'stripeCustomerId' },
	bandSubscriptionSchema: { parse: (v: unknown) => v }
}));
vi.mock('$lib/server/db/schema/directory', () => ({
	directoryEntry: { groupId: 'groupId', contact: 'contact' }
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('$lib/server/finance/payment-service', () => ({ checkout: vi.fn() }));
vi.mock('$lib/server/finance/product-config-service', () => ({
	buildSubscriptionLineItem: vi.fn(),
	getProductConfig: vi.fn()
}));

const { ensureBandStripeCustomer, bandContactEmail } = await import('./band-subscription-service');

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [];
});

describe('the band’s own Stripe customer', () => {
	it('creates one against the band, not the owner', async () => {
		mockCreate.mockResolvedValue({ id: 'cus_band' });
		selectResult = [{ stripeCustomerId: null }];

		const id = await ensureBandStripeCustomer({
			bandId: 'band-1',
			bandName: 'Ninety Proof',
			email: 'book@ninetyproof.example'
		});

		expect(id).toBe('cus_band');
		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Ninety Proof',
				email: 'book@ninetyproof.example',
				// Traceable from the Stripe dashboard, matching the Connect
				// account's `corvmc_group_id`.
				metadata: { corvmc_group_id: 'band-1' }
			})
		);
		expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ stripeCustomerId: 'cus_band' }));
	});

	it('reuses the one it already has', async () => {
		selectResult = [{ stripeCustomerId: 'cus_existing' }];

		expect(await ensureBandStripeCustomer({ bandId: 'band-1', bandName: 'Ninety Proof' })).toBe(
			'cus_existing'
		);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('creates one with no email rather than borrowing a personal address', async () => {
		mockCreate.mockResolvedValue({ id: 'cus_band' });
		selectResult = [{ stripeCustomerId: null }];

		await ensureBandStripeCustomer({ bandId: 'band-1', bandName: 'Ninety Proof', email: null });

		expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ email: undefined }));
	});

	it('reads the act’s contact address off its directory entry', async () => {
		selectResult = [{ contact: { email: 'book@ninetyproof.example' } }];

		expect(await bandContactEmail('band-1')).toBe('book@ninetyproof.example');
	});

	it('returns null when the act has no contact address', async () => {
		selectResult = [{ contact: null }];

		expect(await bandContactEmail('band-1')).toBeNull();
	});
});
