import { db } from '$lib/server/db';
import { subscriber, type SuppressionReason } from '$lib/server/db/schema/marketing';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, isNull, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Subscriber service
// ---------------------------------------------------------------------------
// Subscribers are email addresses that may or may not be linked to a user
// account. The find-or-create pattern ensures we never duplicate by email.
// ---------------------------------------------------------------------------

/**
 * Find an existing subscriber by email, or create one if it doesn't exist.
 * If the subscriber exists and a name is provided, updates the name.
 */
export async function findOrCreateByEmail(
	email: string,
	name?: string
): Promise<{ id: string; email: string; name: string | null; userId: string | null }> {
	const normalized = email.toLowerCase().trim();

	const [row] = await db
		.insert(subscriber)
		.values({ email: normalized, name: name || null })
		.onConflictDoUpdate({
			target: subscriber.email,
			set: name
				? { name: sql`coalesce(${name}, ${subscriber.name})` }
				: { email: sql`${subscriber.email}` }
		})
		.returning({
			id: subscriber.id,
			email: subscriber.email,
			name: subscriber.name,
			userId: subscriber.userId
		});

	return row;
}

/**
 * Globally suppress a subscriber by email — set by Postmark bounce/complaint
 * webhooks. Suppressed subscribers are excluded from every campaign send,
 * regardless of per-audience opt-in. Idempotent; no-op if no matching
 * subscriber exists (we only suppress addresses we've mailed). Returns whether
 * a row was updated.
 */
export async function suppressByEmail(email: string, reason: SuppressionReason): Promise<boolean> {
	const normalized = email.toLowerCase().trim();

	const updated = await db
		.update(subscriber)
		.set({ suppressedAt: new Date(), suppressionReason: reason })
		.where(eq(subscriber.email, normalized))
		.returning({ id: subscriber.id });

	if (updated.length === 0) {
		console.warn(`[marketing] suppress (${reason}) for unknown subscriber: ${normalized}`);
		return false;
	}
	return true;
}

/**
 * Global opt-out chosen by the recipient ("unsubscribe from all"). Suppression
 * excludes the address from every campaign regardless of audience membership,
 * which is what makes it cover audiences they aren't on yet — including
 * built-ins they might start matching later.
 *
 * No-op when already suppressed: a `bounce` or `complaint` is a fact about the
 * address and must not be overwritten with the weaker, reversible reason.
 */
export async function suppressSelfService(subscriberId: string): Promise<void> {
	await db
		.update(subscriber)
		.set({ suppressedAt: new Date(), suppressionReason: 'unsubscribe' })
		.where(and(eq(subscriber.id, subscriberId), isNull(subscriber.suppressedAt)));
}

/**
 * Undo a self-service global opt-out when the person opts back in themselves.
 * Deliberately scoped to `unsubscribe`: opting in must never resurrect an
 * address Postmark told us is bouncing or complaining.
 */
export async function clearSelfServiceSuppression(subscriberId: string): Promise<void> {
	await db
		.update(subscriber)
		.set({ suppressedAt: null, suppressionReason: null })
		.where(and(eq(subscriber.id, subscriberId), eq(subscriber.suppressionReason, 'unsubscribe')));
}

/**
 * Link a subscriber record to a user account.
 */
export async function linkToUser(subscriberId: string, userId: string): Promise<void> {
	await db.update(subscriber).set({ userId }).where(eq(subscriber.id, subscriberId));
}

/**
 * Find a subscriber by email.
 */
export async function findByEmail(email: string) {
	const normalized = email.toLowerCase().trim();
	const [row] = await db.select().from(subscriber).where(eq(subscriber.email, normalized)).limit(1);
	return row ?? null;
}

/**
 * Find a subscriber by linked user account.
 */
export async function findByUserId(userId: string) {
	const [row] = await db.select().from(subscriber).where(eq(subscriber.userId, userId)).limit(1);
	return row ?? null;
}

/**
 * Find or create a subscriber for a user account. Uses the user's email
 * to look up / create the subscriber and links it to the userId.
 */
export async function findOrCreateForUser(
	userId: string,
	userEmail: string,
	userName?: string
): Promise<{ id: string; email: string; name: string | null; userId: string | null }> {
	const sub = await findOrCreateByEmail(userEmail, userName);
	if (!sub.userId) {
		await linkToUser(sub.id, userId);
		return { ...sub, userId };
	}
	return sub;
}

/**
 * Attach the subscriber row already under `email` to a new account.
 *
 * `user_id` is the only column written, so a suppression or per-audience
 * opt-out recorded before the account existed still means opted out after
 * it. `user_id is null` makes it a compare-and-swap: a row another account
 * already claims is left alone. Returns the id linked, or null.
 */
export async function linkExistingSubscriberToUser(
	userId: string,
	email: string
): Promise<string | null> {
	const normalized = email.toLowerCase().trim();

	const [row] = await db
		.update(subscriber)
		.set({ userId })
		.where(and(eq(subscriber.email, normalized), isNull(subscriber.userId)))
		.returning({ id: subscriber.id });

	return row?.id ?? null;
}

/**
 * The reverse order: an account already exists under this subscriber's
 * address. Same rule and same restraint — `user_id` only, and only while the
 * row is unclaimed. A deactivated account does not claim it. Returns the user
 * id linked, or null.
 */
export async function linkSubscriberToExistingUser(
	subscriberId: string,
	email: string
): Promise<string | null> {
	const normalized = email.toLowerCase().trim();

	const [owner] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.email, normalized), isNull(user.deletedAt)))
		.limit(1);
	if (!owner) return null;

	await db
		.update(subscriber)
		.set({ userId: owner.id })
		.where(and(eq(subscriber.id, subscriberId), isNull(subscriber.userId)));

	return owner.id;
}
