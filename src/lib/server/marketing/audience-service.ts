import { db } from '$lib/server/db';
import { audience, audienceMember, subscriber } from '$lib/server/db/schema/marketing';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { findOrCreateByEmail } from './subscriber-service';
import {
	countSystemAudience,
	ensureSystemAudiences,
	getSystemAudiencesForUser,
	isSystemAudienceKey,
	previewSystemAudience
} from './system-audiences';
import { DomainError } from '$lib/server/domain-error';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A built-in audience's membership is computed, so it cannot be edited,
 * deleted, re-slugged, or opened to public opt-in.
 */
export class BuiltInAudienceError extends DomainError {
	readonly httpStatus = 409;

	constructor(message: string) {
		super(message);
	}
}

/** The submitted audience fields are out of range or malformed. */
export class AudienceValidationError extends DomainError {
	readonly httpStatus = 400;

	constructor(message: string) {
		super(message);
	}
}

// ---------------------------------------------------------------------------
// Audience service
// ---------------------------------------------------------------------------
// CRUD for audiences and subscriber management within audiences.
//
// Audiences come in two kinds. A static list is staff-curated: membership lives
// in `audience_member` rows. A built-in ("system") audience has a non-null
// `systemKey` and its membership is a SQL predicate over member attributes —
// see system-audiences.ts. Built-ins reject every membership mutation below,
// because there is no list to edit.
// ---------------------------------------------------------------------------

/** The audience's systemKey, or null for a staff-curated static list. */
async function systemKeyFor(audienceId: string): Promise<string | null> {
	const [row] = await db
		.select({ systemKey: audience.systemKey })
		.from(audience)
		.where(eq(audience.id, audienceId))
		.limit(1);
	return row?.systemKey ?? null;
}

/** Reject a mutation that only makes sense for a staff-curated list. */
async function assertNotSystem(audienceId: string, action: string): Promise<void> {
	if (isSystemAudienceKey(await systemKeyFor(audienceId))) {
		throw new BuiltInAudienceError(
			`Cannot ${action} a built-in audience — its membership is computed`
		);
	}
}

// ---------------------------------------------------------------------------
// Audience CRUD
// ---------------------------------------------------------------------------

export async function createAudience(data: {
	name: string;
	slug: string;
	description?: string;
	allowOptIn?: boolean;
}) {
	if (data.name.length > 255) throw new AudienceValidationError('Audience name too long (max 255)');
	if (data.slug.length > 100) throw new AudienceValidationError('Audience slug too long (max 100)');
	if (!/^[a-z0-9-]+$/.test(data.slug))
		throw new AudienceValidationError('Slug must be lowercase alphanumeric with hyphens');

	const [created] = await db
		.insert(audience)
		.values({
			name: data.name,
			slug: data.slug,
			description: data.description || null,
			allowOptIn: data.allowOptIn ?? false
		})
		.returning();

	return created;
}

export async function updateAudience(
	id: string,
	data: { name?: string; slug?: string; description?: string; allowOptIn?: boolean }
) {
	if (data.name !== undefined && data.name.length > 255)
		throw new AudienceValidationError('Audience name too long (max 255)');
	if (data.slug !== undefined && data.slug.length > 100)
		throw new AudienceValidationError('Audience slug too long (max 100)');
	if (data.slug !== undefined && !/^[a-z0-9-]+$/.test(data.slug))
		throw new AudienceValidationError('Slug must be lowercase alphanumeric with hyphens');

	if (isSystemAudienceKey(await systemKeyFor(id))) {
		// Name and description are staff-editable copy. The slug is the systemKey
		// contract, and opt-in makes no sense for an attribute-defined audience.
		if (data.slug !== undefined)
			throw new BuiltInAudienceError('Cannot change the slug of a built-in audience');
		if (data.allowOptIn)
			throw new BuiltInAudienceError('A built-in audience cannot accept public opt-in');
	}

	const [updated] = await db.update(audience).set(data).where(eq(audience.id, id)).returning();

	return updated ?? null;
}

export async function deleteAudience(id: string) {
	await assertNotSystem(id, 'delete');
	await db.delete(audience).where(eq(audience.id, id));
}

/**
 * How many people on a static list would actually receive a campaign. Counts
 * active memberships only, and drops globally suppressed addresses — a bounce,
 * a complaint, or an "unsubscribe from all" — so the number staff see matches
 * what `getRecipientsForCampaign` will resolve.
 */
const DELIVERABLE_COUNT = sql<number>`cast(count(case when ${audienceMember.unsubscribedAt} is null and ${subscriber.suppressedAt} is null then 1 end) as integer)`;

export async function listAudiences() {
	// Cheap and idempotent: guarantees the built-ins exist without needing a data
	// migration. This is a staff-only, low-traffic path.
	await ensureSystemAudiences();

	const rows = await db
		.select({
			id: audience.id,
			name: audience.name,
			slug: audience.slug,
			description: audience.description,
			allowOptIn: audience.allowOptIn,
			systemKey: audience.systemKey,
			createdAt: audience.createdAt,
			subscriberCount: DELIVERABLE_COUNT
		})
		.from(audience)
		.leftJoin(audienceMember, eq(audienceMember.audienceId, audience.id))
		.leftJoin(subscriber, eq(subscriber.id, audienceMember.subscriberId))
		.groupBy(audience.id)
		.orderBy(audience.name);

	// A built-in's audience_member rows are opt-out tombstones, so the joined
	// count above is meaningless for them — resolve the live size instead.
	return Promise.all(
		rows.map(async (row) =>
			isSystemAudienceKey(row.systemKey)
				? { ...row, subscriberCount: await countSystemAudience(row.id, row.systemKey) }
				: row
		)
	);
}

export async function getAudience(id: string) {
	const [row] = await db
		.select({
			id: audience.id,
			name: audience.name,
			slug: audience.slug,
			description: audience.description,
			allowOptIn: audience.allowOptIn,
			systemKey: audience.systemKey,
			createdAt: audience.createdAt,
			subscriberCount: DELIVERABLE_COUNT
		})
		.from(audience)
		.leftJoin(audienceMember, eq(audienceMember.audienceId, audience.id))
		.leftJoin(subscriber, eq(subscriber.id, audienceMember.subscriberId))
		.where(eq(audience.id, id))
		.groupBy(audience.id);

	if (!row) return null;
	if (!isSystemAudienceKey(row.systemKey)) return row;

	return { ...row, subscriberCount: await countSystemAudience(row.id, row.systemKey) };
}

export async function getAudienceBySlug(slug: string) {
	const [row] = await db
		.select({
			id: audience.id,
			name: audience.name,
			slug: audience.slug,
			description: audience.description,
			allowOptIn: audience.allowOptIn,
			createdAt: audience.createdAt
		})
		.from(audience)
		.where(eq(audience.slug, slug))
		.limit(1);

	return row ?? null;
}

// ---------------------------------------------------------------------------
// Subscriber management within an audience
// ---------------------------------------------------------------------------

/**
 * Add a subscriber to an audience. If already a member but unsubscribed,
 * clears the unsubscribedAt (re-subscribe). If already active, no-op.
 */
export async function addSubscriber(audienceId: string, subscriberId: string) {
	await assertNotSystem(audienceId, 'add a subscriber to');

	const [existing] = await db
		.select({ id: audienceMember.id, unsubscribedAt: audienceMember.unsubscribedAt })
		.from(audienceMember)
		.where(
			and(eq(audienceMember.audienceId, audienceId), eq(audienceMember.subscriberId, subscriberId))
		)
		.limit(1);

	if (existing) {
		if (existing.unsubscribedAt) {
			// Re-subscribe
			await db
				.update(audienceMember)
				.set({ unsubscribedAt: null })
				.where(eq(audienceMember.id, existing.id));
		}
		// Already active — no-op
		return;
	}

	await db.insert(audienceMember).values({ audienceId, subscriberId });
}

/**
 * Hard-remove a subscriber from an audience (staff action, not unsubscribe).
 */
export async function removeSubscriber(audienceId: string, subscriberId: string) {
	await assertNotSystem(audienceId, 'remove a subscriber from');

	await db
		.delete(audienceMember)
		.where(
			and(eq(audienceMember.audienceId, audienceId), eq(audienceMember.subscriberId, subscriberId))
		);
}

/**
 * Unsubscribe from an audience.
 *
 * This is an upsert, not an update. A built-in audience has no membership row
 * to flip — the inserted row IS the opt-out record, and the resolvers in
 * system-audiences.ts exclude anyone who has one. Update-only would have made
 * one-click unsubscribe (RFC 8058) a silent no-op for every built-in.
 *
 * `setWhere` keeps the original opt-out timestamp when the row already exists.
 */
export async function unsubscribe(subscriberId: string, audienceId: string) {
	await db
		.insert(audienceMember)
		.values({ subscriberId, audienceId, unsubscribedAt: new Date() })
		.onConflictDoUpdate({
			target: [audienceMember.subscriberId, audienceMember.audienceId],
			set: { unsubscribedAt: new Date() },
			setWhere: isNull(audienceMember.unsubscribedAt)
		});
}

/**
 * Bulk-add all active user accounts as subscribers to an audience.
 * Creates subscriber records as needed. Returns count of new additions.
 */
export async function bulkAddMembers(audienceId: string): Promise<number> {
	await assertNotSystem(audienceId, 'bulk-add members to');

	const users = await db
		.select({ id: user.id, email: user.email, name: user.name })
		.from(user)
		.where(isNull(user.deletedAt));

	let added = 0;
	for (const u of users) {
		const sub = await findOrCreateByEmail(u.email, u.name);
		// Link to user if not already linked
		if (!sub.userId) {
			const { linkToUser } = await import('./subscriber-service');
			await linkToUser(sub.id, u.id);
		}

		// Check if already a member
		const [existing] = await db
			.select({ id: audienceMember.id, unsubscribedAt: audienceMember.unsubscribedAt })
			.from(audienceMember)
			.where(
				and(eq(audienceMember.audienceId, audienceId), eq(audienceMember.subscriberId, sub.id))
			)
			.limit(1);

		if (!existing) {
			await db.insert(audienceMember).values({ audienceId, subscriberId: sub.id });
			added++;
		} else if (existing.unsubscribedAt) {
			await db
				.update(audienceMember)
				.set({ unsubscribedAt: null })
				.where(eq(audienceMember.id, existing.id));
			added++;
		}
	}

	return added;
}

/**
 * List all subscribers in an audience (including unsubscribed, for staff view).
 */
export async function listSubscribers(audienceId: string) {
	// A built-in has no membership rows to list — only opt-out tombstones — so
	// show a live sample of who it currently resolves to instead.
	const systemKey = await systemKeyFor(audienceId);
	if (isSystemAudienceKey(systemKey)) {
		return previewSystemAudience(audienceId, systemKey);
	}

	return db
		.select({
			id: audienceMember.id,
			subscriberId: subscriber.id,
			email: subscriber.email,
			name: subscriber.name,
			userId: subscriber.userId,
			unsubscribedAt: audienceMember.unsubscribedAt,
			createdAt: audienceMember.createdAt
		})
		.from(audienceMember)
		.innerJoin(subscriber, eq(subscriber.id, audienceMember.subscriberId))
		.where(eq(audienceMember.audienceId, audienceId))
		.orderBy(audienceMember.createdAt);
}

// ---------------------------------------------------------------------------
// Member-facing queries
// ---------------------------------------------------------------------------

/**
 * Get all audiences a user is actively subscribed to (for member account page).
 */
export async function getSubscriptionsForUser(userId: string) {
	const explicit = await db
		.select({
			audienceId: audience.id,
			audienceName: audience.name,
			audienceDescription: audience.description,
			subscribedAt: audienceMember.createdAt
		})
		.from(audienceMember)
		.innerJoin(subscriber, eq(subscriber.id, audienceMember.subscriberId))
		.innerJoin(audience, eq(audience.id, audienceMember.audienceId))
		.where(and(eq(subscriber.userId, userId), isNull(audienceMember.unsubscribedAt)))
		.orderBy(audience.name);

	// Built-ins have no membership row, so they would otherwise be invisible on
	// the account page — leaving members mail they cannot see or opt out of.
	const builtIn = (await getSystemAudiencesForUser(userId)).map((a) => ({
		audienceId: a.id,
		audienceName: a.name,
		audienceDescription: a.description,
		subscribedAt: null
	}));

	return [...explicit, ...builtIn].sort((a, b) => a.audienceName.localeCompare(b.audienceName));
}

/**
 * Get opt-in audiences the user is NOT currently subscribed to.
 */
export async function getOptInAudiencesForUser(userId: string) {
	return db
		.select({
			id: audience.id,
			name: audience.name,
			slug: audience.slug,
			description: audience.description
		})
		.from(audience)
		.where(
			and(
				eq(audience.allowOptIn, true),
				sql`NOT EXISTS (
					SELECT 1 FROM ${audienceMember}
					INNER JOIN ${subscriber} ON ${subscriber.id} = ${audienceMember.subscriberId}
					WHERE ${audienceMember.audienceId} = ${audience.id}
					AND ${subscriber.userId} = ${userId}
					AND ${audienceMember.unsubscribedAt} IS NULL
				)`
			)
		)
		.orderBy(audience.name);
}

/**
 * Get all audiences with allowOptIn = true (for public subscribe page).
 */
export async function getOptInAudiences() {
	return db
		.select({
			id: audience.id,
			name: audience.name,
			slug: audience.slug,
			description: audience.description
		})
		.from(audience)
		.where(eq(audience.allowOptIn, true))
		.orderBy(audience.name);
}
