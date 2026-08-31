import { stripe } from '$lib/server/stripe';
import { db } from '$lib/server/db';
import { paymentCache } from '$lib/server/db/schema/finance';
import { eq } from 'drizzle-orm';
import * as creditService from './credit-service';
import {
	type CreditType,
	type TransactionSource,
	creditTypes
} from '$lib/server/db/schema/finance';
import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
import { getStripeProductId } from './product-config-service';

// ---------------------------------------------------------------------------
// Local line item type — avoids Stripe namespace resolution issues in v22
// ---------------------------------------------------------------------------

/** Subset of Stripe Checkout Session line item params we actually use. */
export interface CheckoutLineItem {
	price?: string;
	price_data?: {
		currency: string;
		product?: string;
		product_data?: { name: string; description?: string };
		unit_amount: number;
		recurring?: { interval: string };
	};
	quantity?: number;
}

// ---------------------------------------------------------------------------
// PaymentService — cart-based checkout, cash recording, refund, cancel
// ---------------------------------------------------------------------------
// checkout() accepts a cart of Stripe line items and handles credit
// application, fee coverage, and session creation. It's generic — callers
// build their own line items and pass metadata for post-checkout linking.
//
// Supports both one-time payments and subscriptions via the `mode` param.
// Anonymous purchases (no userId) skip credit application.
//
// Environment variables:
//   STRIPE_FEE_PRODUCT_ID — product for the fee coverage line item
// ---------------------------------------------------------------------------

async function getFeeProductId(): Promise<string> {
	return getStripeProductId('fee_coverage');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckoutOptions {
	/** Stripe customer ID. Required for subscriptions, optional for one-time. */
	stripeCustomerId?: string;
	/** Customer email. Pre-fills the Stripe Checkout email field when no customer ID is set. */
	customerEmail?: string;
	/** App user ID. When absent, credit application is skipped (anonymous purchase). */
	userId?: string;
	/** Checkout mode — determines one-time vs recurring billing. */
	mode: 'payment' | 'subscription';
	/** Cart line items. Passed directly to Stripe Checkout. */
	lineItems: CheckoutLineItem[];
	/** Credit types eligible for discount, with the unit value in cents per credit. */
	eligibleCredits?: EligibleCredit[];
	/** When true, adds a fee coverage line item so the org nets the full amount. */
	coverFees?: boolean;
	/** Opaque metadata passed through to the Stripe session. */
	metadata?: Record<string, string>;
	successUrl: string;
	cancelUrl: string;
}

/** Describes a credit type eligible for discount on this checkout. */
export interface EligibleCredit {
	type: CreditType;
	/** Value of one credit unit in cents (e.g., 1000 for a $10/hr free hour). */
	unitValueCents: number;
}

export interface CheckoutResult {
	paid: boolean;
	checkoutUrl?: string;
	stripePaymentRecordId?: string;
}

/** A single credit deduction recorded in Stripe metadata for reversal. */
interface CreditDeduction {
	type: CreditType;
	units: number;
	cents: number;
}

// ---------------------------------------------------------------------------
// checkout()
// ---------------------------------------------------------------------------

export async function checkout(options: CheckoutOptions): Promise<CheckoutResult> {
	const {
		stripeCustomerId,
		customerEmail,
		userId,
		mode,
		lineItems,
		eligibleCredits = [],
		coverFees = false,
		metadata = {},
		successUrl,
		cancelUrl
	} = options;

	if (lineItems.length === 0) throw new Error('Cart must have at least one line item');
	if (mode === 'subscription' && !stripeCustomerId) {
		throw new Error('Subscription checkouts require a Stripe customer');
	}
	// Credit coupons are only wired for one-time payments (see step 5). In
	// subscription mode the deduction would happen but the discount never
	// applied — the member's credits would silently vanish.
	if (mode === 'subscription' && eligibleCredits.length > 0) {
		throw new Error('Credit discounts are not supported on subscription checkouts');
	}

	// 1. Calculate cart total by resolving each line item's amount.
	const cartTotalCents = await resolveCartTotal(lineItems);

	// 2. Calculate credit discount (only for authenticated users)
	let creditsAppliedCents = 0;
	const creditDeductions: CreditDeduction[] = [];

	if (userId && eligibleCredits.length > 0) {
		for (const eligible of eligibleCredits) {
			const balance = await creditService.getBalance(userId, eligible.type);
			if (balance <= 0) continue;

			const maxDiscountCents = balance * eligible.unitValueCents;
			const applicableDiscount = Math.min(maxDiscountCents, cartTotalCents - creditsAppliedCents);

			// Whole units only, rounded down: a member is never charged a full
			// credit unit for a partial-unit discount. Any sub-unit remainder is
			// paid in cash and the credit stays in their wallet.
			const unitsToUse = Math.floor(applicableDiscount / eligible.unitValueCents);
			if (unitsToUse > 0) {
				creditDeductions.push({
					type: eligible.type,
					units: unitsToUse,
					cents: unitsToUse * eligible.unitValueCents
				});
				creditsAppliedCents += unitsToUse * eligible.unitValueCents;
			}

			if (creditsAppliedCents >= cartTotalCents) break;
		}
	}

	const remainingCents = cartTotalCents - creditsAppliedCents;

	// 3. Deduct credits optimistically. Reverse all on failure.
	const completedDeductions: CreditDeduction[] = [];
	if (userId) {
		try {
			for (const deduction of creditDeductions) {
				await creditService.deductCredits(
					userId,
					deduction.type,
					deduction.units,
					'checkout',
					metadata.checkout_ref,
					`${deduction.units} ${deduction.type} applied to checkout`
				);
				completedDeductions.push(deduction);
			}
		} catch (err) {
			await reverseDeductions(
				userId,
				completedDeductions,
				metadata.checkout_ref,
				'checkout_failed'
			);
			throw err;
		}
	}

	const sessionMetadata: Record<string, string> = {
		...metadata,
		credits_applied_cents: String(creditsAppliedCents),
		credits_breakdown: JSON.stringify(creditDeductions)
	};

	if (userId) sessionMetadata.user_id = userId;

	// 4. Credits fully cover the price
	if (remainingCents <= 0 && userId) {
		const now = Math.floor(Date.now() / 1000);
		const stripeRecord = await stripe.paymentRecords.reportPayment({
			amount_requested: { value: 0, currency: 'usd' },
			initiated_at: now,
			payment_method_details: {
				custom: { display_name: 'Credits', type: 'custom' },
				type: 'custom'
			},
			metadata: sessionMetadata,
			outcome: 'guaranteed',
			guaranteed: { guaranteed_at: now },
			...(stripeCustomerId && { customer_details: { customer: stripeCustomerId } })
		});

		// Cache locally — best-effort; Stripe is the source of truth
		try {
			await db.insert(paymentCache).values({
				id: stripeRecord.id,
				userId,
				reservationId: metadata.reservation_id ?? null,
				stripeCustomerId: stripeCustomerId ?? null,
				amountCents: 0,
				currency: 'usd',
				paymentMethod: 'Credits',
				status: 'completed',
				paidAt: new Date()
			});
		} catch (err) {
			console.error('[payment-cache] Failed to cache credits payment record:', err);
		}

		return { paid: true, stripePaymentRecordId: stripeRecord.id };
	}

	// 5. Build Checkout Session
	const finalLineItems = [...lineItems];

	// Add fee coverage line item if requested. Below 100¢ the grossed-up fee
	// (2.9% + 30¢) rivals or exceeds the base charge and looks absurd on the
	// receipt, so the org absorbs it for sub-$1 remainders.
	if (coverFees && remainingCents >= 100) {
		const { feeCents } = calculateTotalWithFeeCoverage(remainingCents);
		const feeProductId = await getFeeProductId();
		const feeLineItem: CheckoutLineItem = {
			price_data: {
				currency: 'usd',
				product: feeProductId,
				unit_amount: feeCents,
				...(mode === 'subscription' && { recurring: { interval: 'month' } })
			},
			quantity: 1
		};
		finalLineItems.push(feeLineItem);
	}

	const sessionParams: {
		mode: string;
		line_items: CheckoutLineItem[];
		success_url: string;
		cancel_url: string;
		metadata: Record<string, string>;
		payment_intent_data?: { metadata: Record<string, string> };
		customer?: string;
		customer_email?: string;
		discounts?: Array<{ coupon: string }>;
	} = {
		mode,
		line_items: finalLineItems,
		success_url: successUrl,
		cancel_url: cancelUrl,
		metadata: sessionMetadata,
		...(mode === 'payment' && { payment_intent_data: { metadata: sessionMetadata } })
	};

	if (stripeCustomerId) {
		sessionParams.customer = stripeCustomerId;
	} else if (customerEmail) {
		sessionParams.customer_email = customerEmail;
	}

	// Credits were already deducted (step 3); if the coupon or session creation
	// fails they must be returned, or an aborted checkout silently burns them.
	let couponId: string | undefined;
	try {
		// Apply coupon for credit discount (one-time payments only — subscription
		// mode with credits is rejected up front)
		if (creditsAppliedCents > 0 && mode === 'payment') {
			const coupon = await stripe.coupons.create({
				amount_off: creditsAppliedCents,
				currency: 'usd',
				max_redemptions: 1,
				name: 'Credit discount'
			});
			couponId = coupon.id;
			sessionParams.discounts = [{ coupon: coupon.id }];
		}

		const session = await stripe.checkout.sessions.create(sessionParams as any);

		if (!session.url) {
			throw new Error('Stripe did not return a checkout URL');
		}

		return { paid: false, checkoutUrl: session.url };
	} catch (err) {
		if (userId) {
			await reverseDeductions(
				userId,
				completedDeductions,
				metadata.checkout_ref,
				'checkout_failed'
			);
		}
		// Best-effort: don't leave an orphaned coupon behind a failed session.
		if (couponId) {
			try {
				await stripe.coupons.del(couponId);
			} catch (delErr) {
				console.error('[payment-service] Failed to delete orphaned coupon:', delErr);
			}
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// resolveCartTotal()
// ---------------------------------------------------------------------------

/**
 * Calculate the cart total in cents by resolving each line item.
 * Items with `price_data.unit_amount` are used directly.
 * Items with a `price` reference are fetched from Stripe.
 */
async function resolveCartTotal(lineItems: CheckoutLineItem[]): Promise<number> {
	let total = 0;

	for (const item of lineItems) {
		const quantity = item.quantity ?? 1;

		if (item.price_data?.unit_amount != null) {
			total += item.price_data.unit_amount * quantity;
		} else if (item.price) {
			const price = await stripe.prices.retrieve(item.price);
			total += (price.unit_amount ?? 0) * quantity;
		}
	}

	return total;
}

// ---------------------------------------------------------------------------
// recordCashPayment()
// ---------------------------------------------------------------------------

export interface CashPaymentOptions {
	userId: string;
	stripeCustomerId: string;
	amountCents: number;
	metadata?: Record<string, string>;
	/** Payment method label (default 'Cash'); use 'Credits' for $0 credit settlements. */
	displayName?: string;
	/**
	 * What this payment reconciles against, for `processor_details.payment_reference`
	 * — Stripe's "opaque string for manual reconciliation". Required rather than
	 * defaulted: the whole value of the field is that somebody holding a Stripe
	 * record can find the thing it paid for, and a generated placeholder would
	 * satisfy the API while destroying that.
	 */
	reference: string;
}

export async function recordCashPayment(
	options: CashPaymentOptions
): Promise<{ paymentRecordId: string }> {
	const {
		userId,
		stripeCustomerId,
		amountCents,
		metadata = {},
		displayName = 'Cash',
		reference
	} = options;

	const now = Math.floor(Date.now() / 1000);
	const stripeRecord = await stripe.paymentRecords.reportPayment({
		amount_requested: { value: amountCents, currency: 'usd' },
		initiated_at: now,
		// `custom` takes `display_name` OR `type`, never both — sending both is
		// rejected outright, on every API version tested. And `processor_details`
		// is required, not optional as the shape here long implied. Both facts were
		// established against the live test API; see the note below.
		payment_method_details: {
			type: 'custom',
			custom: { display_name: displayName }
		},
		processor_details: {
			type: 'custom',
			custom: { payment_reference: reference }
		},
		metadata,
		outcome: 'guaranteed',
		guaranteed: { guaranteed_at: now },
		customer_details: { customer: stripeCustomerId }
	});

	// Cache locally — best-effort; Stripe is the source of truth
	try {
		await db.insert(paymentCache).values({
			id: stripeRecord.id,
			userId,
			reservationId: metadata.reservation_id ?? null,
			stripeCustomerId,
			amountCents,
			currency: 'usd',
			paymentMethod: displayName,
			status: 'completed',
			paidAt: new Date()
		});
	} catch (err) {
		console.error('[payment-cache] Failed to cache cash payment record:', err);
	}

	return { paymentRecordId: stripeRecord.id };
}

// ---------------------------------------------------------------------------
// refund()
// ---------------------------------------------------------------------------

export interface RefundOptions {
	/** Required when credits were applied (to reverse them). */
	userId?: string;
	stripePaymentRecordId: string;
	metadata?: Record<string, string>;
}

export async function refund(options: RefundOptions): Promise<void> {
	const { userId, stripePaymentRecordId } = options;

	// Idempotency guard (JAVASCRIPT-SVELTEKIT-29). Refund and Cancel are separate
	// staff actions that both land here, so refund-then-cancel called Stripe
	// twice; the second raised "charge has already been refunded" *after*
	// cancel() had flipped the reservation to cancelled, stranding it with
	// credits un-reversed and no cancellation event.
	//
	// This also protects the credit ledger: reverseDeductions has no dedupe of
	// its own, so a second pass would credit the member twice.
	const [cached] = await db
		.select({ status: paymentCache.status })
		.from(paymentCache)
		.where(eq(paymentCache.id, stripePaymentRecordId))
		.limit(1);

	if (cached?.status === 'refunded') return;

	if (stripePaymentRecordId.startsWith('pi_')) {
		await refundPaymentIntent(stripePaymentRecordId, userId);
	} else {
		await refundPaymentRecord(stripePaymentRecordId, userId);
	}

	await db
		.update(paymentCache)
		.set({ status: 'refunded', refundedAt: new Date() })
		.where(eq(paymentCache.id, stripePaymentRecordId));
}

async function refundPaymentIntent(paymentIntentId: string, userId?: string): Promise<void> {
	const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
		expand: ['latest_charge']
	});

	// A PaymentIntent stays `succeeded` after being refunded and its `amount` is
	// the requested amount, never decremented — so neither field can tell you
	// whether a refund already happened. Only the charge knows.
	const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
	const captured = charge?.amount_captured ?? pi.amount;
	const alreadyRefunded = charge?.amount_refunded ?? 0;
	const outstanding = captured - alreadyRefunded;

	if (pi.status === 'succeeded' && outstanding > 0) {
		await stripe.refunds.create({ payment_intent: paymentIntentId });
	}

	if (userId) {
		const deductions = parseBreakdown(pi.metadata);
		if (deductions.length === 0) {
			const sessions = await stripe.checkout.sessions.list({
				payment_intent: paymentIntentId,
				limit: 1
			});
			const session = sessions.data[0];
			if (session) {
				const sessionDeductions = parseBreakdown(session.metadata);
				await reverseDeductions(userId, sessionDeductions, paymentIntentId, 'refund');
			}
		} else {
			await reverseDeductions(userId, deductions, paymentIntentId, 'refund');
		}
	}
}

async function refundPaymentRecord(paymentRecordId: string, userId?: string): Promise<void> {
	const stripeRecord = await stripe.paymentRecords.retrieve(paymentRecordId);
	const paymentAmount = stripeRecord.amount?.value ?? 0;

	if (paymentAmount > 0) {
		const now = Math.floor(Date.now() / 1000);
		await stripe.paymentRecords.reportRefund(paymentRecordId, {
			amount: { value: paymentAmount, currency: 'usd' },
			initiated_at: now,
			outcome: 'refunded',
			refunded: { refunded_at: now },
			processor_details: { type: 'custom' }
		});
	}

	if (userId) {
		const deductions = parseBreakdown(stripeRecord.metadata);
		await reverseDeductions(userId, deductions, paymentRecordId, 'refund');
	}
}

// ---------------------------------------------------------------------------
// cancel()
// ---------------------------------------------------------------------------

export interface CancelOptions {
	/** Required when credits were applied (to reverse them). */
	userId?: string;
	stripeCheckoutSessionId?: string;
}

export async function cancel(options: CancelOptions): Promise<void> {
	const { userId, stripeCheckoutSessionId } = options;

	if (!stripeCheckoutSessionId) return;

	const session = await stripe.checkout.sessions.retrieve(stripeCheckoutSessionId);

	// A completed session was paid — its credits were spent, not abandoned.
	// Reversing here would hand them back on top of the delivered purchase.
	if (session.status === 'complete') return;

	if (userId) {
		const deductions = parseBreakdown(session.metadata);
		await reverseDeductions(userId, deductions, stripeCheckoutSessionId, 'cancelled');
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse credits_breakdown from Stripe metadata. */
function parseBreakdown(metadata: Record<string, string> | null | undefined): CreditDeduction[] {
	const raw = metadata?.credits_breakdown;
	if (!raw) return [];

	try {
		const parsed = JSON.parse(raw) as CreditDeduction[];
		return parsed.filter((d) => creditTypes.includes(d.type) && d.units > 0);
	} catch {
		return [];
	}
}

/** Reverse a list of credit deductions back to the user's wallets. */
async function reverseDeductions(
	userId: string,
	deductions: CreditDeduction[],
	sourceId: string | undefined,
	source: TransactionSource
): Promise<void> {
	for (const deduction of deductions) {
		await creditService.addCredits(
			userId,
			deduction.type,
			deduction.units,
			source,
			sourceId,
			`Reversed ${deduction.units} ${deduction.type}`
		);
	}
}
