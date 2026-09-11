/**
 * Buying a record.
 *
 * Two paths that share a row and nothing else. A **free** release never touches
 * Stripe — Stripe's own charge minimum is 50¢, so a $0 checkout is not a thing
 * that exists — and is fulfilled the moment it is asked for. A **paid** one goes
 * through the same `checkout()` every other purchasable uses, with a destination
 * account and an application fee attached.
 *
 * The lifecycle follows `ticket`'s exactly, because it is the shape the finance
 * module already knows: a `pending` row exists before the redirect, the webhook's
 * domain event flips it to `paid`, and a cron sweep clears what was abandoned.
 */
import { db } from '$lib/server/db';
import { audioRelease, audioTrack, releasePurchase } from '$lib/server/db/schema/audio';
import { group } from '$lib/server/db/schema/group';
import { and, count, eq, lt, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { checkout } from '$lib/server/finance/payment-service';
import { getStripeProductId } from '$lib/server/finance/product-config-service';
import { destinationFor } from './connect-service';
import { validateSplit } from '$lib/finance/audio-split';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { stripe } from '$lib/server/stripe';

export class ReleaseNotForSaleError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('This release is not available.');
	}
}

export class BandCannotBePaidError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This band has not finished setting up payouts, so it cannot sell yet.');
	}
}

export class PurchaseNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Purchase not found.');
	}
}

export class PurchaseNotRefundableError extends DomainError {
	readonly httpStatus = 400;
	constructor(reason: string) {
		super(reason);
	}
}

export class InvalidSplitError extends DomainError {
	readonly httpStatus = 400;
	constructor(reason: string) {
		super(reason);
	}
}

/** How long an unpaid row survives before the sweep clears it. */
export const ABANDONED_PURCHASE_MS = 24 * 60 * 60 * 1000;

export type BeginPurchaseInput = {
	bandSlug: string;
	releaseSlug: string;
	buyerEmail: string;
	userId?: string | null;
	totalCents: number;
	platformCents: number;
	coverFees: boolean;
	/**
	 * Minted by the caller, not here, because the success URL has to contain it
	 * and that URL is built before this runs. Generating it internally would mean
	 * either a placeholder in the redirect or a second round trip to learn it.
	 */
	downloadToken: string;
	successUrl: string;
	cancelUrl: string;
};

export type BeginPurchaseResult = {
	purchaseId: string;
	downloadToken: string;
	/** Absent for a free release: there is nothing to pay and nowhere to send them. */
	checkoutUrl?: string;
	paid: boolean;
};

/**
 * Start a purchase, and finish it immediately when there is nothing to charge.
 *
 * The release is resolved from its slugs rather than taken as an id, so a
 * caller cannot buy a draft by knowing one — publication is checked as part of
 * the lookup rather than after it.
 */
export async function beginPurchase(input: BeginPurchaseInput): Promise<BeginPurchaseResult> {
	const [found] = await db
		.select({
			release: audioRelease,
			bandId: group.id,
			bandName: group.name
		})
		.from(audioRelease)
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(
			and(
				eq(group.slug, input.bandSlug),
				eq(audioRelease.slug, input.releaseSlug),
				eq(audioRelease.status, 'published'),
				sql`${audioRelease.deletedAt} IS NULL`,
				sql`${group.deletedAt} IS NULL`
			)
		)
		.limit(1);

	if (!found) throw new ReleaseNotForSaleError();
	const { release } = found;

	// The server recomputes the whole split from the release's own floor. What
	// the client posted is an *allocation*, never an amount to be trusted — these
	// numbers become `application_fee_amount`.
	const validation = validateSplit({
		totalCents: input.totalCents,
		platformCents: input.platformCents,
		coverFees: input.coverFees,
		priceMinCents: release.priceMinCents,
		allowPayMore: release.allowPayMore
	});
	if (!validation.ok) throw new InvalidSplitError(validation.reason);
	const split = validation.split;

	const purchaseId = crypto.randomUUID();
	const downloadToken = input.downloadToken;

	// Free, and taken for free: no charge exists, so there is no checkout to
	// send anyone to. The row is written already paid.
	if (split.chargeCents === 0) {
		const [row] = await db
			.insert(releasePurchase)
			.values({
				releaseId: release.id,
				userId: input.userId ?? null,
				buyerEmail: input.buyerEmail,
				purchaseId,
				amountPaidCents: 0,
				platformFeeCents: 0,
				bandNetCents: 0,
				feeCoveredCents: 0,
				status: 'paid',
				downloadToken,
				paidAt: new Date()
			})
			.returning();

		await emitPurchased(row.id);
		return { purchaseId, downloadToken, paid: true };
	}

	const destination = await destinationFor(found.bandId);
	// Checked here rather than only at publish time: a band's Stripe account can
	// be restricted by Stripe *after* a paid release went up, and the buyer must
	// not reach a checkout that cannot settle.
	if (!destination) throw new BandCannotBePaidError();

	const [row] = await db
		.insert(releasePurchase)
		.values({
			releaseId: release.id,
			userId: input.userId ?? null,
			buyerEmail: input.buyerEmail,
			purchaseId,
			amountPaidCents: split.chargeCents,
			// What the collective actually keeps, net of its share of card
			// processing — the same figure the buyer was shown on the bar, so a
			// band reconciling a Stripe deposit meets one number, not two.
			platformFeeCents: split.platformNetCents,
			bandNetCents: split.bandCents,
			feeCoveredCents: split.feeCoveredCents,
			status: 'pending',
			downloadToken
		})
		.returning();

	const lineItems = [
		{
			price_data: {
				currency: 'usd',
				product: await getStripeProductId('audio_release'),
				product_data: undefined,
				unit_amount: split.chargeCents - split.feeCoveredCents
			},
			quantity: 1
		}
	];

	// The buyer's fee coverage as its own line, so the receipt reads the way the
	// split bar did. `coverFees` stays false: the surcharge is already in
	// `split`, and letting `checkout()` add its own would charge it twice.
	if (split.feeCoveredCents > 0) {
		lineItems.push({
			price_data: {
				currency: 'usd',
				product: await getStripeProductId('fee_coverage'),
				product_data: undefined,
				unit_amount: split.feeCoveredCents
			},
			quantity: 1
		});
	}

	const result = await checkout({
		mode: 'payment',
		userId: input.userId ?? undefined,
		customerEmail: input.buyerEmail,
		lineItems,
		eligibleCredits: [],
		coverFees: false,
		destinationAccountId: destination,
		applicationFeeCents: split.applicationFeeCents,
		metadata: {
			type: 'audio_purchase',
			purchase_id: purchaseId,
			release_id: release.id,
			row_id: row.id
		},
		successUrl: input.successUrl,
		cancelUrl: input.cancelUrl,
		// Paid on our own page. `elements` places no restriction on
		// `payment_intent_data`, so the destination charge that pays the band —
		// `transfer_data` plus `application_fee_amount` — carries across unchanged;
		// only `success_url`, `cancel_url` and `branding_settings` are disallowed,
		// and `checkout()` already maps the first two.
		uiMode: 'elements'
	});

	return {
		purchaseId,
		downloadToken,
		checkoutUrl: result.checkoutUrl,
		paid: result.paid
	};
}

/**
 * Flip a pending purchase to paid. Idempotent: the webhook may deliver twice,
 * and a second pass must not re-emit the buyer's email.
 */
export async function fulfillPurchase(
	purchaseId: string,
	paymentIntentId: string | null,
	paymentRecordId: string | null
): Promise<boolean> {
	const updated = await db
		.update(releasePurchase)
		.set({
			status: 'paid',
			stripePaymentIntentId: paymentIntentId,
			stripePaymentRecordId: paymentRecordId,
			paidAt: new Date()
		})
		// The status predicate is what makes this idempotent — a redelivery
		// matches nothing and returns no rows.
		.where(and(eq(releasePurchase.purchaseId, purchaseId), eq(releasePurchase.status, 'pending')))
		.returning({ id: releasePurchase.id });

	if (updated.length === 0) return false;
	await emitPurchased(updated[0].id);
	return true;
}

/** Everything the buyer's receipt needs, gathered once. */
async function emitPurchased(rowId: string): Promise<void> {
	const [row] = await db
		.select({
			purchase: releasePurchase,
			releaseTitle: audioRelease.title,
			releaseSlug: audioRelease.slug,
			bandName: group.name,
			bandSlug: group.slug
		})
		.from(releasePurchase)
		.innerJoin(audioRelease, eq(audioRelease.id, releasePurchase.releaseId))
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(eq(releasePurchase.id, rowId))
		.limit(1);

	if (!row) return;

	await domainEvents.emit('audio.purchased', {
		purchaseId: row.purchase.purchaseId,
		downloadToken: row.purchase.downloadToken,
		buyerEmail: row.purchase.buyerEmail,
		releaseTitle: row.releaseTitle,
		releaseSlug: row.releaseSlug,
		bandName: row.bandName,
		bandSlug: row.bandSlug,
		amountPaidCents: row.purchase.amountPaidCents,
		platformFeeCents: row.purchase.platformFeeCents,
		bandNetCents: row.purchase.bandNetCents
	});
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/**
 * Give the money back, on a Connect charge.
 *
 * **Not the `refund()` the rest of the finance module uses.** That one reports a
 * refund against a Payment Record, which is the right shape when CMC keeps the
 * money. Here it does not: the band was paid by a transfer out of the platform's
 * balance at the moment of sale, so undoing the sale means undoing three things
 * rather than one.
 *
 * - `reverse_transfer` claws the band's share back out of its connected account.
 * - `refund_application_fee` returns the collective's cut, which is what makes
 *   this a refund rather than CMC keeping its 10% of a sale that did not happen.
 * - Without either flag the collective refunds a buyer **out of its own pocket**
 *   while the band keeps its share — a silent, one-directional loss that nothing
 *   would have reported.
 *
 * That is also why `stripe_payment_intent_id` is stored alongside the Payment
 * Record id: reversing a transfer is an operation on the charge, not on the
 * record that describes it.
 *
 * If the connected account has already paid out and its balance is short, Stripe
 * makes it negative and recovers from the band's next sale. That is Stripe's
 * behaviour and deliberately not worked around here — the alternative is CMC
 * fronting the money and inventing a debt nothing tracks.
 *
 * Idempotent on status, so a double-click cannot refund twice. The download dies
 * on its own: every read of a token is gated on `status = 'paid'`.
 */
export async function refundPurchase(purchaseId: string): Promise<void> {
	const [row] = await db
		.select({
			id: releasePurchase.id,
			status: releasePurchase.status,
			amountPaidCents: releasePurchase.amountPaidCents,
			paymentIntentId: releasePurchase.stripePaymentIntentId
		})
		.from(releasePurchase)
		.where(eq(releasePurchase.purchaseId, purchaseId))
		.limit(1);

	if (!row) throw new PurchaseNotFoundError();
	// Not an error. Two staff on the same row, or a retried request, should land
	// on the same state rather than on a Stripe call that fails confusingly.
	if (row.status === 'refunded') return;
	if (row.status !== 'paid') {
		throw new PurchaseNotRefundableError('Only a completed purchase can be refunded.');
	}

	// A free download never reached Stripe, so there is nothing to reverse — but
	// revoking it is still meaningful, and the status flip below does that.
	if (row.amountPaidCents > 0) {
		if (!row.paymentIntentId) {
			throw new PurchaseNotRefundableError(
				'This purchase has no Stripe payment on file, so it cannot be refunded automatically.'
			);
		}

		await stripe.refunds.create({
			payment_intent: row.paymentIntentId,
			refund_application_fee: true,
			reverse_transfer: true
		});
	}

	await db
		.update(releasePurchase)
		.set({ status: 'refunded', refundedAt: new Date() })
		.where(eq(releasePurchase.id, row.id));
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

/** The purchase a download token names, if it is paid. */
export async function findPaidPurchaseByToken(token: string) {
	const row = await findPurchaseByToken(token);
	return row?.purchase.status === 'paid' ? row : null;
}

/**
 * The purchase behind a token whatever its status, so a caller can tell
 * "not paid yet" from "no such token".
 *
 * Only the download page needs that distinction, and only because paying on our
 * own page means the buyer can arrive before `checkout.session.completed` has
 * been delivered. Everything that hands over files goes through
 * `findPaidPurchaseByToken` above and still sees a pending purchase as nothing
 * at all.
 */
export async function findPurchaseByToken(token: string) {
	const [row] = await db
		.select({
			purchase: releasePurchase,
			releaseId: audioRelease.id,
			releaseTitle: audioRelease.title,
			bandName: group.name
		})
		.from(releasePurchase)
		.innerJoin(audioRelease, eq(audioRelease.id, releasePurchase.releaseId))
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(eq(releasePurchase.downloadToken, token))
		.limit(1);
	return row ?? null;
}

/** A track, only if this token's purchase covers the release it belongs to. */
export async function trackForToken(token: string, trackId: string) {
	const purchase = await findPaidPurchaseByToken(token);
	if (!purchase) return null;

	const [track] = await db
		.select()
		.from(audioTrack)
		.where(and(eq(audioTrack.id, trackId), eq(audioTrack.releaseId, purchase.releaseId)))
		.limit(1);

	// A track id from another release is a 404, not a 403: whether it exists is
	// not this caller's business.
	return track ?? null;
}

export async function recordDownload(purchaseRowId: string): Promise<void> {
	await db
		.update(releasePurchase)
		.set({ downloadCount: sql`${releasePurchase.downloadCount} + 1` })
		.where(eq(releasePurchase.id, purchaseRowId));
}

/** What a signed-in buyer owns. */
export async function listPurchasesForUser(userId: string) {
	return db
		.select({
			purchaseId: releasePurchase.purchaseId,
			downloadToken: releasePurchase.downloadToken,
			amountPaidCents: releasePurchase.amountPaidCents,
			paidAt: releasePurchase.paidAt,
			releaseTitle: audioRelease.title,
			releaseSlug: audioRelease.slug,
			bandName: group.name,
			bandSlug: group.slug
		})
		.from(releasePurchase)
		.innerJoin(audioRelease, eq(audioRelease.id, releasePurchase.releaseId))
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(and(eq(releasePurchase.userId, userId), eq(releasePurchase.status, 'paid')))
		.orderBy(sql`${releasePurchase.paidAt} DESC`);
}

/**
 * Clear rows for checkouts nobody completed.
 *
 * Only `pending`, and only past the window — a row still inside it may belong to
 * somebody who has Stripe open in another tab. Nothing here touches R2: an
 * abandoned purchase never owned a file.
 */
export async function sweepAbandonedPurchases(now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - ABANDONED_PURCHASE_MS);
	const removed = await db
		.delete(releasePurchase)
		.where(and(eq(releasePurchase.status, 'pending'), lt(releasePurchase.createdAt, cutoff)))
		.returning({ id: releasePurchase.id });
	return removed.length;
}

/** Sales for a band, for its payouts page. */
export async function salesSummaryForBand(groupId: string) {
	const [row] = await db
		.select({
			sales: count(),
			gross: sql<number>`COALESCE(SUM(${releasePurchase.amountPaidCents}), 0)`,
			toBand: sql<number>`COALESCE(SUM(${releasePurchase.bandNetCents}), 0)`,
			toCollective: sql<number>`COALESCE(SUM(${releasePurchase.platformFeeCents}), 0)`
		})
		.from(releasePurchase)
		.innerJoin(audioRelease, eq(audioRelease.id, releasePurchase.releaseId))
		.where(and(eq(audioRelease.groupId, groupId), eq(releasePurchase.status, 'paid')));

	return {
		sales: Number(row?.sales ?? 0),
		grossCents: Number(row?.gross ?? 0),
		toBandCents: Number(row?.toBand ?? 0),
		toCollectiveCents: Number(row?.toCollective ?? 0)
	};
}
