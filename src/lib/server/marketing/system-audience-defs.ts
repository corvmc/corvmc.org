import { sql, type SQL } from 'drizzle-orm';
import { bandMember } from '$lib/server/db/schema/band';
import { group } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';

// ---------------------------------------------------------------------------
// Built-in ("system") audience definitions
// ---------------------------------------------------------------------------
// A system audience has an `audience` row like any other — so campaign
// targeting, the unsubscribe HMAC (which signs `subscriberId:audienceId`), and
// the /unsubscribe/[token] route all work unchanged — but its membership is
// never stored in `audience_member`. It is a SQL predicate over `user`,
// evaluated when the campaign sends and when staff view the count.
//
// Consequences worth knowing:
//   - Opt-outs are tombstones. Since there is no membership row to flip, an
//     unsubscribe INSERTs an `audience_member` row with `unsubscribedAt` set,
//     and the resolvers exclude any subscriber that has one. See
//     audience-service.unsubscribe().
//   - Only members can match. Subscribers with no linked `userId` (public
//     newsletter signups, press contacts) never appear in a system audience.
//     Keep a static list for those.
//   - This is a closed, code-defined set. It is deliberately not a
//     user-authored rules engine.
//
// This module is kept free of `$lib` imports so scripts/seed-dev.ts — which
// runs under tsx, where SvelteKit aliases don't resolve — can provision the
// same audiences. Query and mutation helpers live in system-audiences.ts.
// ---------------------------------------------------------------------------

type SystemAudienceDef = {
	name: string;
	description: string;
	/** Predicate over the `user` table. Must qualify outer references. */
	predicate: () => SQL;
};

/**
 * A member is sustaining when their `user.subscription` snapshot is non-null —
 * see finance/subscription-service.ts. The legacy `sustaining` role is NOT
 * maintained by the Stripe flow and must not be used for status checks.
 *
 * We test the column directly rather than calling `isSustainingMemberSql`:
 * that helper exists to correlate *into* `user` from another table's select
 * list, and here `user` is already in the FROM clause.
 */
const SUSTAINING = sql`"user"."subscription" is not null`;

/**
 * Correlated EXISTS over band membership.
 *
 * Every table and column is interpolated rather than written as a string, so
 * `pnpm check` can see inside the predicate and a schema rename cannot leave it
 * compiling but broken. That also removes the aliases an earlier version needed:
 * each table appears once here, so the fully qualified names are unambiguous on
 * their own, and drizzle renders the correlated outer reference as
 * `"user"."id"` — prefix intact — which is the part that has to stay qualified.
 * Both `band` and `band_member` have their own `id`, so an unqualified outer
 * reference would silently bind to the wrong table instead of failing loudly;
 * `system-audiences.spec.ts` asserts the rendered SQL to keep it that way.
 */
const LEADS_A_BAND = sql`exists (
	select 1 from ${bandMember}
	inner join ${group} on ${group.id} = ${bandMember.bandId}
	where ${bandMember.userId} = ${user.id}
		and ${bandMember.role} in ('owner', 'admin')
		and ${bandMember.status} = 'active'
		and ${group.deletedAt} is null
)`;

/** Active (not soft-deleted) member accounts. */
const ACTIVE_MEMBER = sql`"user"."deleted_at" is null`;

export const SYSTEM_AUDIENCES = {
	'all-members': {
		name: 'All Members',
		description: 'Every active member account. Updates automatically as people join and leave.',
		predicate: () => ACTIVE_MEMBER
	},
	'sustaining-members': {
		name: 'Sustaining Members',
		description: 'Members with an active sustaining membership subscription.',
		predicate: () => sql`${ACTIVE_MEMBER} and ${SUSTAINING}`
	},
	'non-sustaining-members': {
		name: 'Non-Sustaining Members',
		description: 'Active members without a sustaining membership — the audience for upgrade asks.',
		predicate: () => sql`${ACTIVE_MEMBER} and not ${SUSTAINING}`
	},
	'band-leaders': {
		name: 'Band Leaders',
		description: 'Members who own or administer an active band.',
		predicate: () => sql`${ACTIVE_MEMBER} and ${LEADS_A_BAND}`
	}
} as const satisfies Record<string, SystemAudienceDef>;

export type SystemAudienceKey = keyof typeof SYSTEM_AUDIENCES;

export function isSystemAudienceKey(key: string | null | undefined): key is SystemAudienceKey {
	return key != null && key in SYSTEM_AUDIENCES;
}
