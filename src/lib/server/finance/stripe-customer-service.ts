import { stripe } from '#lib/server/stripe.js';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { and, eq, isNull } from 'drizzle-orm';

async function storedStripeId(userId: string): Promise<string | null> {
	const [row] = await db
		.select({ stripeId: user.stripeId })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return row?.stripeId ?? null;
}

/**
 * The member's Stripe customer, created on first use.
 *
 * Two first calls at once both read no id. The idempotency key, from the user
 * id, makes Stripe return the same customer to both (for 24 hours, and only
 * while the parameters match), and the write only fills an empty column.
 */
export async function ensureStripeCustomer(
	userId: string,
	email: string,
	name?: string
): Promise<string> {
	const existing = await storedStripeId(userId);
	if (existing) return existing;

	const customer = await stripe.customers.create(
		{ email, name, metadata: { userId } },
		{ idempotencyKey: `customer:user:${userId}` }
	);

	await db
		.update(user)
		.set({ stripeId: customer.id })
		.where(and(eq(user.id, userId), isNull(user.stripeId)));

	return (await storedStripeId(userId)) ?? customer.id;
}
