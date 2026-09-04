import type Stripe from 'stripe';
import { stripe } from '$lib/server/stripe';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { eq } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';

// ---------------------------------------------------------------------------
// BillingService — the half of the Stripe billing portal that was not already
// in the app.
//
// Modifying the contribution, cancelling and resuming already live in
// `subscription-service`. What the portal alone could do was manage the card on
// file and show the invoice history, and there is no embeddable version of it:
// Stripe documents that the portal cannot be iframed, so replacing it means
// building against the API. That is all this file is.
//
// Nothing here takes a customer id from the client. Every function is called
// with the id read off the session user in `billing.remote.ts`, which is what
// keeps one member's card off another member's page.
// ---------------------------------------------------------------------------

/** The caller asked to act on a payment method that is not theirs, or is gone. */
export class PaymentMethodError extends DomainError {
	readonly httpStatus = 400;
}

/** A saved card, reduced to what a member's billing page actually shows. */
export interface SavedCard {
	id: string;
	brand: string;
	last4: string;
	expMonth: number;
	expYear: number;
	/** True for the card the active subscription will be billed against. */
	isDefault: boolean;
}

/** One line of billing history, as the member's page renders it. */
export interface BillingInvoice {
	id: string;
	created: Date;
	amountPaidCents: number;
	currency: string;
	status: string;
	/** Stripe's own hosted receipt and PDF. Null on an invoice too new to have them. */
	hostedUrl: string | null;
	pdfUrl: string | null;
}

/**
 * Begin adding a card. The client secret is what `confirmSetup` in the browser
 * needs; nothing is charged.
 *
 * `usage: 'off_session'` because the point of a saved card is the renewal
 * nobody is present for — a card saved as `on_session` is refused when the
 * subscription invoices itself a month later.
 */
export async function createSetupIntent(stripeCustomerId: string): Promise<string> {
	const intent = await stripe.setupIntents.create({
		customer: stripeCustomerId,
		usage: 'off_session'
	});

	if (!intent.client_secret) throw new Error('Stripe did not return a setup intent secret');
	return intent.client_secret;
}

/** The active subscription for a customer, or null. */
async function activeSubscription(
	stripeCustomerId: string
): Promise<Stripe.Subscription | undefined> {
	const { data } = await stripe.subscriptions.list({
		customer: stripeCustomerId,
		status: 'active',
		limit: 1
	});
	return data[0];
}

function defaultPaymentMethodId(sub: Stripe.Subscription | undefined): string | null {
	const value = sub?.default_payment_method;
	if (!value) return null;
	return typeof value === 'string' ? value : value.id;
}

export async function listCards(stripeCustomerId: string): Promise<SavedCard[]> {
	const [{ data }, sub] = await Promise.all([
		stripe.paymentMethods.list({ customer: stripeCustomerId, type: 'card' }),
		activeSubscription(stripeCustomerId)
	]);

	const defaultId = defaultPaymentMethodId(sub);

	return data
		.filter((method): method is Stripe.PaymentMethod & { card: Stripe.PaymentMethod.Card } =>
			Boolean(method.card)
		)
		.map((method) => ({
			id: method.id,
			brand: method.card.brand,
			last4: method.card.last4,
			expMonth: method.card.exp_month,
			expYear: method.card.exp_year,
			isDefault: method.id === defaultId
		}));
}

/**
 * Confirm a card belongs to this customer before acting on it.
 *
 * A payment method id is guessable in shape but not in value, which is not a
 * permission model — this is. Returns the method so the caller can read its
 * card off it without a second round trip.
 */
async function ownedCard(
	stripeCustomerId: string,
	paymentMethodId: string
): Promise<Stripe.PaymentMethod> {
	const { data } = await stripe.paymentMethods.list({
		customer: stripeCustomerId,
		type: 'card'
	});
	const method = data.find((m) => m.id === paymentMethodId);
	if (!method) throw new PaymentMethodError('That card is not on this account.');
	return method;
}

/**
 * Bill the subscription against this card from now on, and mirror it onto the
 * user row so the page can name the card without a Stripe call.
 */
export async function setDefaultCard(
	userId: string,
	stripeCustomerId: string,
	paymentMethodId: string
): Promise<void> {
	const method = await ownedCard(stripeCustomerId, paymentMethodId);
	const sub = await activeSubscription(stripeCustomerId);

	// A member with a card but no subscription is an ordinary state — they
	// cancelled, or they are about to subscribe. The card is still theirs and
	// still the one to remember; there is just nothing to point at it yet.
	if (sub) {
		await stripe.subscriptions.update(sub.id, { default_payment_method: paymentMethodId });
	}

	await mirrorCardOntoUser(userId, method);
}

/**
 * Remove a card.
 *
 * Refused when it is the last one and a subscription is live: Stripe would
 * accept it and then fail the next renewal, which the member would find out
 * about from a dunning email rather than from this page.
 */
export async function removeCard(
	userId: string,
	stripeCustomerId: string,
	paymentMethodId: string
): Promise<void> {
	await ownedCard(stripeCustomerId, paymentMethodId);

	const [cards, sub] = await Promise.all([
		listCards(stripeCustomerId),
		activeSubscription(stripeCustomerId)
	]);

	if (sub && cards.length <= 1) {
		throw new PaymentMethodError(
			'This is the only card on your membership. Add another before removing this one, or cancel your contribution first.'
		);
	}

	await stripe.paymentMethods.detach(paymentMethodId);

	// Promote a survivor rather than leaving the subscription pointing at a
	// detached card. Stripe falls back to the customer's default, which this app
	// has never set, so "it will figure it out" is not true here.
	if (sub && defaultPaymentMethodId(sub) === paymentMethodId) {
		const next = (await listCards(stripeCustomerId))[0];
		if (next) await setDefaultCard(userId, stripeCustomerId, next.id);
	} else {
		const remaining = await listCards(stripeCustomerId);
		const current = remaining.find((c) => c.isDefault) ?? remaining[0];
		await patchUserCard(userId, current ?? null);
	}
}

/** Mirror a newly attached card onto the user row and make it the default. */
export async function rememberCard(
	userId: string,
	stripeCustomerId: string,
	paymentMethodId: string
): Promise<void> {
	await setDefaultCard(userId, stripeCustomerId, paymentMethodId);
}

async function mirrorCardOntoUser(userId: string, method: Stripe.PaymentMethod): Promise<void> {
	await patchUserCard(
		userId,
		method.card ? { brand: method.card.brand, last4: method.card.last4 } : null
	);
}

/**
 * `user.pmType` / `user.pmLastFour` are dormant columns inherited from the
 * Laravel Cashier schema — nothing has ever written them. They are exactly the
 * shape a "Visa •••• 4242" line needs and they already ride on the session
 * user, so the header can name the card with no query at all.
 */
async function patchUserCard(
	userId: string,
	card: { brand: string; last4: string } | null
): Promise<void> {
	await db
		.update(user)
		.set({ pmType: card?.brand ?? null, pmLastFour: card?.last4 ?? null })
		.where(eq(user.id, userId));
}

export async function listInvoices(
	stripeCustomerId: string,
	limit = 12
): Promise<BillingInvoice[]> {
	const { data } = await stripe.invoices.list({ customer: stripeCustomerId, limit });

	return (
		data
			// A draft invoice is a number Stripe has not committed to yet; showing it
			// as history would put an amount on the page that can still change.
			.filter((invoice) => invoice.status !== 'draft' && invoice.id)
			.map((invoice) => ({
				id: invoice.id!,
				created: new Date(invoice.created * 1000),
				amountPaidCents: invoice.amount_paid ?? 0,
				currency: invoice.currency ?? 'usd',
				status: invoice.status ?? 'open',
				hostedUrl: invoice.hosted_invoice_url ?? null,
				pdfUrl: invoice.invoice_pdf ?? null
			}))
	);
}
