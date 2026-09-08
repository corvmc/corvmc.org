/**
 * A band's own Stripe account, so music sales pay the band and not the
 * collective.
 *
 * CMC becomes a Stripe *platform* here, which is a real change in posture:
 * money for a record never rests in the collective's balance beyond the
 * application fee, Stripe handles the band's tax forms and payout schedule, and
 * there is no disbursement queue for staff to run. The cost is that a band
 * cannot sell until it has finished Stripe's onboarding, which is why every read
 * below reports *why* it cannot rather than just that it cannot.
 *
 * Nothing in this module decides who may call it — the guard lives in
 * `audio.remote.ts`.
 */
import type Stripe from 'stripe';
import { stripe } from '$lib/server/stripe';
import { db } from '$lib/server/db';
import { bandStripeAccount } from '$lib/server/db/schema/audio';
import { eq } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';

export class ConnectNotConfiguredError extends DomainError {
	readonly httpStatus = 400;
	constructor() {
		super('This band has not set up payouts yet.');
	}
}

export type BandPayoutStatus = {
	/** No row at all — the band has never started. */
	connected: boolean;
	stripeAccountId: string | null;
	/** The gate on selling: Stripe will not accept a charge without it. */
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	detailsSubmitted: boolean;
	/** What Stripe still wants, verbatim, so the prompt can say what is missing. */
	requirementsDue: string[];
};

function requirementsFrom(json: unknown): string[] {
	const due = (json as { currently_due?: unknown } | null)?.currently_due;
	return Array.isArray(due) ? due.filter((d): d is string => typeof d === 'string') : [];
}

export async function getPayoutStatus(groupId: string): Promise<BandPayoutStatus> {
	const [row] = await db
		.select()
		.from(bandStripeAccount)
		.where(eq(bandStripeAccount.groupId, groupId))
		.limit(1);

	if (!row) {
		return {
			connected: false,
			stripeAccountId: null,
			chargesEnabled: false,
			payoutsEnabled: false,
			detailsSubmitted: false,
			requirementsDue: []
		};
	}

	return {
		connected: true,
		stripeAccountId: row.stripeAccountId,
		chargesEnabled: row.chargesEnabled,
		payoutsEnabled: row.payoutsEnabled,
		detailsSubmitted: row.detailsSubmitted,
		requirementsDue: requirementsFrom(row.requirementsJson)
	};
}

/** The account id a charge should be destined for, or null when it cannot be. */
export async function destinationFor(groupId: string): Promise<string | null> {
	const status = await getPayoutStatus(groupId);
	return status.connected && status.chargesEnabled ? status.stripeAccountId : null;
}

/**
 * The band's Stripe account, created on first use.
 *
 * Idempotent by the row: a second call returns the existing account rather than
 * minting another. That matters because an abandoned onboarding is the common
 * case — people start this and come back a week later — and a fresh account each
 * time would leave a trail of half-finished ones with no way to tell which is
 * live.
 */
export async function ensureAccount(input: {
	groupId: string;
	bandName: string;
	email?: string | null;
}): Promise<string> {
	const existing = await getPayoutStatus(input.groupId);
	if (existing.connected && existing.stripeAccountId) return existing.stripeAccountId;

	const account = await stripe.accounts.create({
		type: 'express',
		business_type: 'company',
		business_profile: {
			name: input.bandName,
			product_description: 'Recorded music sold through the Corvallis Music Collective'
		},
		email: input.email ?? undefined,
		capabilities: {
			// The only capability a destination charge needs. Deliberately not
			// requesting `card_payments`: the band is not the merchant of record,
			// CMC is, and asking for more than is needed lengthens onboarding.
			transfers: { requested: true }
		},
		// The link back. A Stripe account that cannot be traced to a band is
		// unresolvable from the dashboard, which is where a support question starts.
		metadata: { corvmc_group_id: input.groupId }
	});

	await db.insert(bandStripeAccount).values({
		groupId: input.groupId,
		stripeAccountId: account.id,
		chargesEnabled: account.charges_enabled ?? false,
		payoutsEnabled: account.payouts_enabled ?? false,
		detailsSubmitted: account.details_submitted ?? false,
		requirementsJson: account.requirements ?? null
	});

	return account.id;
}

/**
 * A one-time onboarding URL.
 *
 * Account links expire in minutes and are single-use, so this is generated per
 * click rather than stored. `refresh_url` is where Stripe sends someone whose
 * link went stale — it has to start the flow again, not show an error.
 */
export async function createOnboardingLink(input: {
	groupId: string;
	bandName: string;
	email?: string | null;
	returnUrl: string;
	refreshUrl: string;
}): Promise<string> {
	const accountId = await ensureAccount(input);

	const link = await stripe.accountLinks.create({
		account: accountId,
		refresh_url: input.refreshUrl,
		return_url: input.returnUrl,
		type: 'account_onboarding'
	});

	return link.url;
}

/**
 * A link into Stripe's own dashboard for an onboarded account.
 *
 * Where a band goes to change its bank details or read its payout history —
 * things CMC deliberately does not mirror, because mirroring them would mean
 * holding a copy of a band's banking information.
 */
export async function createDashboardLink(groupId: string): Promise<string> {
	const status = await getPayoutStatus(groupId);
	if (!status.connected || !status.stripeAccountId) throw new ConnectNotConfiguredError();

	const link = await stripe.accounts.createLoginLink(status.stripeAccountId);
	return link.url;
}

/**
 * Mirror an `account.updated` event onto the row.
 *
 * Stripe is the source of truth for every flag here and the app never writes
 * one itself. Keyed on the Stripe account id rather than on the metadata,
 * because the metadata is ours and the id is the thing Stripe guarantees.
 * Silently ignores an account we do not know about — the platform may hold
 * accounts created outside this feature, and a 500 on one would make Stripe
 * retry it forever.
 */
export async function syncAccountFromStripe(account: Stripe.Account): Promise<boolean> {
	const [row] = await db
		.select({ groupId: bandStripeAccount.groupId })
		.from(bandStripeAccount)
		.where(eq(bandStripeAccount.stripeAccountId, account.id))
		.limit(1);

	if (!row) return false;

	await db
		.update(bandStripeAccount)
		.set({
			chargesEnabled: account.charges_enabled ?? false,
			payoutsEnabled: account.payouts_enabled ?? false,
			detailsSubmitted: account.details_submitted ?? false,
			requirementsJson: account.requirements ?? null,
			updatedAt: new Date()
		})
		.where(eq(bandStripeAccount.stripeAccountId, account.id));

	return true;
}
