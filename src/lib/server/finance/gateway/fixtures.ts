import type Stripe from 'stripe';

/**
 * Typed skeletons for the Stripe objects the fake gateway hands back.
 *
 * Each builder returns the *exact* Stripe type, so anything the application
 * reads off one of these is checked against Stripe's real shape and a pinned
 * `apiVersion` bump that renames a field turns the reader red at `pnpm check`.
 *
 * The single `as T` per builder is the deliberate trade-off: Stripe's object
 * types carry 50-100 required members each, almost all of them nullable and
 * none of them read by this application. Spelling every one out would be a few
 * hundred lines of `null` that no test asserts on. What you pass *in* is fully
 * checked; what you leave out is what the app never touches.
 *
 * To raise fidelity later, capture real objects from a sandbox
 * (`stripe sandbox create`, then `stripe fixtures ./fixtures.json`) and paste
 * them in as the defaults — the call sites below would not change.
 */
function build<T>(shape: Partial<T>): T {
	return shape as T;
}

let counter = 0;
/** Ids follow the seed's convention (`scripts/seed/payments.ts`) so seeded and faked rows read alike. */
export function fakeId(prefix: string): string {
	counter += 1;
	return `${prefix}_fake_${String(counter).padStart(6, '0')}`;
}

/** Reset the id counter so a test run is reproducible. */
export function resetFakeIds(): void {
	counter = 0;
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export function fakeCheckoutSession(
	over: Partial<Stripe.Checkout.Session>
): Stripe.Checkout.Session {
	return build<Stripe.Checkout.Session>({
		id: fakeId('cs'),
		object: 'checkout.session',
		created: nowSeconds(),
		currency: 'usd',
		livemode: false,
		status: 'open',
		payment_status: 'unpaid',
		amount_subtotal: 0,
		amount_total: 0,
		metadata: {},
		mode: 'payment',
		...over
	});
}

export function fakePaymentIntent(over: Partial<Stripe.PaymentIntent>): Stripe.PaymentIntent {
	return build<Stripe.PaymentIntent>({
		id: fakeId('pi'),
		object: 'payment_intent',
		created: nowSeconds(),
		currency: 'usd',
		livemode: false,
		status: 'succeeded',
		amount: 0,
		metadata: {},
		...over
	});
}

export function fakeCharge(over: Partial<Stripe.Charge>): Stripe.Charge {
	return build<Stripe.Charge>({
		id: fakeId('ch'),
		object: 'charge',
		created: nowSeconds(),
		currency: 'usd',
		livemode: false,
		status: 'succeeded',
		amount: 0,
		amount_captured: 0,
		amount_refunded: 0,
		...over
	});
}

export function fakeRefund(over: Partial<Stripe.Refund>): Stripe.Refund {
	return build<Stripe.Refund>({
		id: fakeId('re'),
		object: 'refund',
		created: nowSeconds(),
		currency: 'usd',
		status: 'succeeded',
		amount: 0,
		...over
	});
}

export function fakeCustomer(over: Partial<Stripe.Customer>): Stripe.Customer {
	return build<Stripe.Customer>({
		id: fakeId('cus'),
		object: 'customer',
		created: nowSeconds(),
		livemode: false,
		metadata: {},
		...over
	});
}

export function fakeProduct(over: Partial<Stripe.Product>): Stripe.Product {
	return build<Stripe.Product>({
		id: fakeId('prod'),
		object: 'product',
		created: nowSeconds(),
		updated: nowSeconds(),
		livemode: false,
		active: true,
		metadata: {},
		name: 'Fake product',
		...over
	});
}

export function fakePrice(over: Partial<Stripe.Price>): Stripe.Price {
	return build<Stripe.Price>({
		id: fakeId('price'),
		object: 'price',
		created: nowSeconds(),
		livemode: false,
		active: true,
		currency: 'usd',
		metadata: {},
		unit_amount: 0,
		...over
	});
}

export function fakeCoupon(over: Partial<Stripe.Coupon>): Stripe.Coupon {
	return build<Stripe.Coupon>({
		id: fakeId('coupon'),
		object: 'coupon',
		created: nowSeconds(),
		livemode: false,
		valid: true,
		times_redeemed: 0,
		...over
	});
}

export function fakeSubscription(over: Partial<Stripe.Subscription>): Stripe.Subscription {
	return build<Stripe.Subscription>({
		id: fakeId('sub'),
		object: 'subscription',
		created: nowSeconds(),
		livemode: false,
		status: 'active',
		cancel_at_period_end: false,
		metadata: {},
		start_date: nowSeconds(),
		...over
	});
}

export function fakeInvoice(over: Partial<Stripe.Invoice>): Stripe.Invoice {
	return build<Stripe.Invoice>({
		id: fakeId('in'),
		object: 'invoice',
		created: nowSeconds(),
		currency: 'usd',
		livemode: false,
		status: 'paid',
		metadata: {},
		total: 0,
		...over
	});
}

export function fakePaymentRecord(over: Partial<Stripe.PaymentRecord>): Stripe.PaymentRecord {
	return build<Stripe.PaymentRecord>({
		id: fakeId('pr'),
		object: 'payment_record',
		created: nowSeconds(),
		livemode: false,
		metadata: {},
		...over
	});
}

export function fakePaymentMethod(over: Partial<Stripe.PaymentMethod>): Stripe.PaymentMethod {
	return build<Stripe.PaymentMethod>({
		id: fakeId('pm'),
		object: 'payment_method',
		created: nowSeconds(),
		livemode: false,
		type: 'card',
		metadata: {},
		card: {
			brand: 'visa',
			last4: '4242',
			exp_month: 12,
			exp_year: new Date().getUTCFullYear() + 2
		} as Stripe.PaymentMethod.Card,
		...over
	});
}

export function fakeSetupIntent(over: Partial<Stripe.SetupIntent>): Stripe.SetupIntent {
	const id = over.id ?? fakeId('seti');
	return build<Stripe.SetupIntent>({
		id,
		object: 'setup_intent',
		created: nowSeconds(),
		livemode: false,
		status: 'requires_payment_method',
		usage: 'off_session',
		metadata: {},
		// Stripe's own shape: the secret is the id plus an opaque suffix, and
		// Stripe.js parses the id back out of it. Minting it any other way would
		// let a test pass against a secret the real SDK would reject.
		client_secret: `${id}_secret_fake`,
		...over
	});
}
