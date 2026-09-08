import { db } from '$lib/server/db';
import { audience, audienceMember, subscriber } from '$lib/server/db/schema/marketing';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import {
	SYSTEM_AUDIENCES,
	isSystemAudienceKey,
	type SystemAudienceKey
} from './system-audience-defs';

// ---------------------------------------------------------------------------
// Built-in ("system") audiences — queries and provisioning
// ---------------------------------------------------------------------------
// The registry itself lives in system-audience-defs.ts, which is free of $lib
// imports so the seed script can provision the same audiences. Read that file
// first for what a system audience is and how opt-outs work.
// ---------------------------------------------------------------------------

export { SYSTEM_AUDIENCES, isSystemAudienceKey, type SystemAudienceKey };

// D1 rejects a statement with more than 100 bound parameters. Each backfilled
// subscriber binds 4 (id, email, name, userId), so 20 rows per statement keeps
// us well inside the cap.
const BACKFILL_CHUNK = 20;

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * Insert an `audience` row for any built-in that doesn't have one yet.
 * Idempotent — safe to call on every staff page load and from the seed script.
 * Existing rows are left alone so staff edits to name/description survive.
 */
export async function ensureSystemAudiences(): Promise<void> {
	const existing = await db
		.select({ systemKey: audience.systemKey })
		.from(audience)
		.where(inArray(audience.systemKey, Object.keys(SYSTEM_AUDIENCES)));

	const have = new Set(existing.map((r) => r.systemKey));
	const missing = (Object.keys(SYSTEM_AUDIENCES) as SystemAudienceKey[]).filter(
		(key) => !have.has(key)
	);
	if (missing.length === 0) return;

	await db.insert(audience).values(
		missing.map((key) => ({
			name: SYSTEM_AUDIENCES[key].name,
			slug: key,
			description: SYSTEM_AUDIENCES[key].description,
			// A system audience is defined by member attributes, so there is
			// nothing for a public visitor to opt into.
			allowOptIn: false,
			systemKey: key
		}))
	);
}

/**
 * Make sure every user matching `predicate` has a `subscriber` row linked to
 * their account. Members who never subscribed to anything have no subscriber
 * record, and would otherwise silently vanish from a system audience.
 *
 * Two passes, because `subscriber.email` is unique: link rows that already
 * exist under the member's address (a public signup who later joined), then
 * create rows for the rest.
 *
 * The linking pass needs a verified address (#757). Bare email equality is not
 * proof of control, and that row holds a stranger's memberships and suppression
 * state. Creating a fresh row does not, so it stays unconditional.
 */
export async function ensureSubscribersForUsers(predicate: SQL): Promise<void> {
	const unlinked = await db
		.select({
			userId: user.id,
			email: user.email,
			name: user.name,
			emailVerified: user.emailVerified,
			subscriberId: subscriber.id
		})
		.from(user)
		.leftJoin(subscriber, eq(subscriber.email, user.email))
		.where(and(predicate, isNull(subscriber.userId)));

	if (unlinked.length === 0) return;

	// A row already under this address, just not linked to the account yet.
	for (const u of unlinked) {
		if (!u.subscriberId || !u.emailVerified) continue;
		await db.update(subscriber).set({ userId: u.userId }).where(eq(subscriber.id, u.subscriberId));
	}

	const toCreate = unlinked.filter((u) => !u.subscriberId);
	for (let i = 0; i < toCreate.length; i += BACKFILL_CHUNK) {
		const chunk = toCreate.slice(i, i + BACKFILL_CHUNK);
		await db
			.insert(subscriber)
			.values(chunk.map((u) => ({ email: u.email, name: u.name, userId: u.userId })))
			.onConflictDoNothing();
	}
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * SQL: this subscriber has not opted out of `audienceId`. For a system
 * audience an `audience_member` row exists only as an opt-out tombstone.
 */
function notOptedOut(audienceId: string): SQL {
	return sql`not exists (
		select 1 from ${audienceMember}
		where ${audienceMember.audienceId} = ${audienceId}
			and ${audienceMember.subscriberId} = ${subscriber.id}
			and ${audienceMember.unsubscribedAt} is not null
	)`;
}

/**
 * Resolve the current recipients of a system audience. Backfills subscriber
 * records first so members who have never subscribed are still reachable.
 */
export async function resolveSystemAudienceRecipients(
	audienceId: string,
	key: SystemAudienceKey
): Promise<{ subscriberId: string; email: string; name: string | null; audienceId: string }[]> {
	const predicate = SYSTEM_AUDIENCES[key].predicate();
	await ensureSubscribersForUsers(predicate);

	const rows = await db
		.select({ subscriberId: subscriber.id, email: subscriber.email, name: subscriber.name })
		.from(subscriber)
		.innerJoin(user, eq(user.id, subscriber.userId))
		.where(and(predicate, isNull(subscriber.suppressedAt), notOptedOut(audienceId)));

	return rows.map((r) => ({ ...r, audienceId }));
}

/**
 * Live size of a system audience, for staff UI. Counts matching members rather
 * than subscriber rows, so it is accurate before any backfill has run — but
 * still excludes members who have opted out or been suppressed.
 */
export async function countSystemAudience(audienceId: string, key: SystemAudienceKey) {
	const [row] = await db
		// distinct: a user could in principle have more than one subscriber row
		// (different addresses linked to the same account).
		.select({ count: sql<number>`cast(count(distinct "user"."id") as integer)` })
		.from(user)
		.leftJoin(subscriber, eq(subscriber.userId, user.id))
		.where(
			and(
				SYSTEM_AUDIENCES[key].predicate(),
				isNull(subscriber.suppressedAt),
				sql`not exists (
					select 1 from ${audienceMember}
					inner join ${subscriber} s on s."id" = ${audienceMember.subscriberId}
					where ${audienceMember.audienceId} = ${audienceId}
						and s."user_id" = "user"."id"
						and ${audienceMember.unsubscribedAt} is not null
				)`
			)
		);

	return row?.count ?? 0;
}

/** Cap on the staff preview list — "All Members" could be thousands of rows. */
export const PREVIEW_LIMIT = 100;

/**
 * Read-only sample of who a system audience currently resolves to, for the
 * staff detail page. Reads from `user` rather than `subscriber` — and skips the
 * backfill — so members who have never subscribed still show up, and viewing
 * the page never writes.
 *
 * Applies the same exclusions as `countSystemAudience`, so the preview and the
 * headline count can never disagree.
 */
export async function previewSystemAudience(audienceId: string, key: SystemAudienceKey) {
	return db
		.select({
			subscriberId: subscriber.id,
			email: user.email,
			name: user.name,
			userId: user.id,
			unsubscribedAt: audienceMember.unsubscribedAt,
			createdAt: user.createdAt
		})
		.from(user)
		.leftJoin(subscriber, eq(subscriber.userId, user.id))
		.leftJoin(
			audienceMember,
			and(eq(audienceMember.subscriberId, subscriber.id), eq(audienceMember.audienceId, audienceId))
		)
		.where(
			and(
				SYSTEM_AUDIENCES[key].predicate(),
				isNull(subscriber.suppressedAt),
				// Left join: a member with no audience_member row at all passes,
				// a tombstoned one is excluded.
				isNull(audienceMember.unsubscribedAt)
			)
		)
		.orderBy(user.name)
		.limit(PREVIEW_LIMIT);
}

/**
 * The system audiences a member currently matches, minus any they have opted
 * out of. Powers the member account page so built-ins are visible and leavable.
 */
export async function getSystemAudiencesForUser(userId: string) {
	const rows = await db
		.select({
			id: audience.id,
			name: audience.name,
			description: audience.description,
			systemKey: audience.systemKey
		})
		.from(audience)
		.where(inArray(audience.systemKey, Object.keys(SYSTEM_AUDIENCES)));

	const matched: typeof rows = [];
	for (const row of rows) {
		if (!isSystemAudienceKey(row.systemKey)) continue;

		const [hit] = await db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.id, userId), SYSTEM_AUDIENCES[row.systemKey].predicate()))
			.limit(1);
		if (!hit) continue;

		const [optOut] = await db
			.select({ id: audienceMember.id })
			.from(audienceMember)
			.innerJoin(subscriber, eq(subscriber.id, audienceMember.subscriberId))
			.where(
				and(
					eq(audienceMember.audienceId, row.id),
					eq(subscriber.userId, userId),
					isNotNull(audienceMember.unsubscribedAt)
				)
			)
			.limit(1);
		if (optOut) continue;

		matched.push(row);
	}

	return matched;
}
