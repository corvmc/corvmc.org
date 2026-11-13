import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const mockStripe = { customers: { create: vi.fn() } };
vi.mock('#lib/server/stripe.js', () => ({ stripe: mockStripe }));

const { ensureStripeCustomer } = await import('./stripe-customer-service');
const { createFakeGateway } = await import('./gateway/fake-gateway');

const stripeIds = () =>
	sqlite.prepare('select id, stripe_id from user order by id').all() as {
		id: string;
		stripe_id: string | null;
	}[];

describe('ensureStripeCustomer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sqlite.exec('delete from user');
		sqlite.exec(
			`insert into user (id, name, email, stripe_id) values
				('user-1', 'One', 'one@example.com', null),
				('user-2', 'Two', 'two@example.com', 'cus_two')`
		);
	});

	it('returns existing stripeId without calling Stripe', async () => {
		expect(await ensureStripeCustomer('user-2', 'two@example.com')).toBe('cus_two');
		expect(mockStripe.customers.create).not.toHaveBeenCalled();
	});

	it('creates the customer and stores it on that user alone', async () => {
		mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });

		expect(await ensureStripeCustomer('user-1', 'one@example.com')).toBe('cus_new');
		expect(mockStripe.customers.create).toHaveBeenCalledWith(
			{ email: 'one@example.com', name: undefined, metadata: { userId: 'user-1' } },
			{ idempotencyKey: 'customer:user:user-1' }
		);
		expect(stripeIds()).toEqual([
			{ id: 'user-1', stripe_id: 'cus_new' },
			{ id: 'user-2', stripe_id: 'cus_two' }
		]);
	});

	it('passes name to Stripe when provided', async () => {
		mockStripe.customers.create.mockResolvedValue({ id: 'cus_named' });

		await ensureStripeCustomer('user-1', 'one@example.com', 'Jane Doe');

		expect(mockStripe.customers.create).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Jane Doe' }),
			expect.anything()
		);
	});

	// Both reads find no id before either Stripe call returns (#2681). The fake
	// replays an idempotency key as Stripe does.
	it('creates one customer when two first calls overlap', async () => {
		const fake = createFakeGateway();
		mockStripe.customers.create.mockImplementation(fake.customers.create);

		const ids = await Promise.all([
			ensureStripeCustomer('user-1', 'one@example.com'),
			ensureStripeCustomer('user-1', 'one@example.com')
		]);

		expect(ids[1]).toBe(ids[0]);
		expect(stripeIds()[0]).toEqual({ id: 'user-1', stripe_id: ids[0] });
	});
});
