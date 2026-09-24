import type Stripe from 'stripe';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { eventListing } from '$lib/server/db/schema/event';
import { marketVendor } from '$lib/server/db/schema/market';
import { DomainError } from '$lib/server/domain-error';
import { checkout, refund } from '$lib/server/finance/payment-service';
import { buildLineItem } from '$lib/server/finance/product-config-service';

/**
 * Market vendor table fees (#1502). The fee is fixed on the vendor row at
 * acceptance; the vendor pays it through the payments seam from a link in the
 * acceptance message; CMC refunds it when CMC cancels — declining an accepted
 * vendor, or cancelling the market. A vendor who withdraws is not refunded.
 */

export const VENDOR_FEE_CHECKOUT_TYPE = 'market_vendor_fee';

export class VendorFeeNotDueError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('There is no table fee to pay for this application.');
	}
}

export class VendorFeeAmountError extends DomainError {
	readonly httpStatus = 400;
}

/** Where the vendor pays. The vendor id is the bearer: vendors have no account. */
export function vendorPayPath(vendorId: string): string {
	return `/market/pay/${vendorId}`;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function loadFeeRow(vendorId: string) {
	const [row] = await db
		.select({
			id: marketVendor.id,
			eventId: marketVendor.eventId,
			status: marketVendor.status,
			businessName: marketVendor.businessName,
			feeCents: marketVendor.feeCents,
			feeFloorCents: marketVendor.feeFloorCents,
			paidCents: marketVendor.paidCents,
			paidAt: marketVendor.paidAt,
			refundedAt: marketVendor.refundedAt,
			stripePaymentRecordId: marketVendor.stripePaymentRecordId,
			title: eventListing.title,
			startsAt: eventListing.startsAt
		})
		.from(marketVendor)
		.innerJoin(eventListing, eq(eventListing.id, marketVendor.eventId))
		.where(eq(marketVendor.id, vendorId))
		.limit(1);
	return row ?? null;
}

/** What the public pay page shows. Null for an id that names nothing. No contact detail. */
export async function getVendorFee(vendorId: string) {
	const row = await loadFeeRow(vendorId);
	if (!row) return null;
	return {
		vendorId: row.id,
		businessName: row.businessName,
		marketTitle: row.title,
		startsAt: row.startsAt,
		feeCents: row.feeCents,
		floorCents: row.feeFloorCents,
		slidingScale: row.feeFloorCents < row.feeCents,
		paidCents: row.paidCents,
		refunded: row.refundedAt !== null,
		due: row.status === 'accepted' && row.feeCents > 0 && row.paidAt === null
	};
}

export type VendorFee = NonNullable<Awaited<ReturnType<typeof getVendorFee>>>;

/**
 * Start a checkout for the fee. On a sliding scale `chosenCents` is the
 * vendor's choice; null pays the whole fee.
 */
export async function startVendorFeeCheckout(
	vendorId: string,
	chosenCents: number | null,
	origin: string
): Promise<{ checkoutUrl: string }> {
	const row = await loadFeeRow(vendorId);
	if (!row || row.status !== 'accepted' || row.feeCents <= 0 || row.paidAt !== null) {
		throw new VendorFeeNotDueError();
	}
	const amountCents = chosenCents ?? row.feeCents;
	if (
		!Number.isInteger(amountCents) ||
		amountCents < row.feeFloorCents ||
		amountCents > row.feeCents
	) {
		throw new VendorFeeAmountError(
			row.feeFloorCents < row.feeCents
				? `Pay between ${dollars(row.feeFloorCents)} and ${dollars(row.feeCents)}.`
				: `The table fee is ${dollars(row.feeCents)}.`
		);
	}

	const result = await checkout({
		mode: 'payment',
		lineItems: [await buildLineItem('market_table', amountCents, 1)],
		metadata: { type: VENDOR_FEE_CHECKOUT_TYPE, vendor_id: row.id, event_id: row.eventId },
		successUrl: `${origin}${vendorPayPath(row.id)}?paid=1`,
		cancelUrl: `${origin}${vendorPayPath(row.id)}`,
		uiMode: 'elements'
	});
	if (!result.checkoutUrl) throw new Error('Checkout could not be started');
	return { checkoutUrl: result.checkoutUrl };
}

/** A completed checkout. Anything but a vendor fee is ignored; a repeat changes nothing. */
export async function recordVendorFeePaid(session: Stripe.Checkout.Session): Promise<void> {
	const meta = session.metadata ?? {};
	if (meta.type !== VENDOR_FEE_CHECKOUT_TYPE || !meta.vendor_id) return;
	const paymentRecordId =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: (session.payment_intent?.id ?? session.id);
	await db
		.update(marketVendor)
		.set({
			paidCents: session.amount_total ?? 0,
			paidAt: new Date(),
			stripePaymentRecordId: paymentRecordId,
			updatedAt: new Date()
		})
		.where(and(eq(marketVendor.id, meta.vendor_id), isNull(marketVendor.paidAt)));
}

/** Refund a vendor's paid fee. False when there was nothing to refund. */
export async function refundVendorFee(vendorId: string): Promise<boolean> {
	const row = await loadFeeRow(vendorId);
	if (!row?.stripePaymentRecordId || row.paidAt === null || row.refundedAt !== null) return false;
	await refund({ stripePaymentRecordId: row.stripePaymentRecordId });
	await db
		.update(marketVendor)
		.set({ refundedAt: new Date(), updatedAt: new Date() })
		.where(eq(marketVendor.id, vendorId));
	return true;
}

/** The market was cancelled: refund every fee still held. Returns how many were refunded. */
export async function refundMarketFees(eventId: string): Promise<number> {
	const rows = await db
		.select({ id: marketVendor.id })
		.from(marketVendor)
		.where(
			and(
				eq(marketVendor.eventId, eventId),
				isNotNull(marketVendor.paidAt),
				isNull(marketVendor.refundedAt)
			)
		);
	let refunded = 0;
	for (const { id } of rows) {
		if (await refundVendorFee(id)) refunded++;
	}
	return refunded;
}
