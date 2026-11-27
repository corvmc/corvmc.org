import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { linkExistingSubscriberToUser } from '#lib/server/marketing/subscriber-service.js';
import { captureException } from '#lib/server/sentry.js';
import { linkGuestTicketsToUser } from '#lib/server/ticket/ticket-service.js';

/**
 * Every record keyed by an address waits for that address to be verified
 * (#757, #3408), and every path that verifies one calls this: better-auth's
 * link click and a confirmed email change. A new "claim by address" record
 * is added here, not at the call sites. Each claim is non-fatal.
 */
export async function claimVerifiedEmail(userId: string, email: string): Promise<void> {
	try {
		await linkExistingSubscriberToUser(userId, email);
	} catch (err) {
		captureException(err);
	}
	try {
		await linkGuestTicketsToUser(userId, email);
	} catch (err) {
		captureException(err);
	}
}

/**
 * The live account whose address is already verified, for a purchase made
 * under that address. The owner proved it, so the tickets link at purchase;
 * an unverified account does not claim them until its link is clicked.
 * Returns the user id, or null.
 */
export async function verifiedAccountIdForEmail(email: string): Promise<string | null> {
	const normalized = email.toLowerCase().trim();
	const [owner] = await db
		.select({ id: user.id })
		.from(user)
		.where(
			and(
				sql`lower(${user.email}) = ${normalized}`,
				eq(user.emailVerified, true),
				isNull(user.deletedAt)
			)
		)
		.limit(1);
	return owner?.id ?? null;
}

/**
 * Whether a live account holds the address, verified or not. Only for mail
 * going to that address: the answer must never reach a page, because anyone
 * can type an address into a form.
 */
export async function hasAccountForEmail(email: string): Promise<boolean> {
	const [owner] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(sql`lower(${user.email}) = ${email.toLowerCase().trim()}`, isNull(user.deletedAt)))
		.limit(1);
	return Boolean(owner);
}

/**
 * Who a purchase belongs to: the signed-in buyer, else the verified account
 * under the address. A failed lookup leaves the ticket a guest ticket, which
 * the next verification still claims, so it never fails the purchase.
 */
export async function purchaseOwnerId(
	signedInUserId: string | null | undefined,
	email: string
): Promise<string | undefined> {
	if (signedInUserId) return signedInUserId;
	try {
		return (await verifiedAccountIdForEmail(email)) ?? undefined;
	} catch (err) {
		captureException(err);
		return undefined;
	}
}
