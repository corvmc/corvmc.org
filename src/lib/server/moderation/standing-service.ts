import { db } from '$lib/server/db';
import { memberStanding } from '$lib/server/db/schema/standing';
import type { FlagEntityType } from '$lib/server/db/schema/flag';
import { eq, and } from 'drizzle-orm';
import {
	standingScopes,
	standingScopeConfig,
	STANDING_REASON_MAX,
	type StandingScope,
	type StandingStatus
} from '$lib/config';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A status the scope has no meaning for — `disabled` on a posting scope, say.
 *
 * A programming error rather than something a member can provoke: every write
 * path picks its own status. It throws instead of silently storing the value so
 * a scope can never accumulate rows no reader knows how to interpret.
 */
export class StandingStatusNotAllowedError extends Error {
	constructor(scope: StandingScope, status: StandingStatus) {
		super(`"${status}" is not a standing ${scope} can hold`);
		this.name = 'StandingStatusNotAllowedError';
	}
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface Standing {
	status: StandingStatus;
	reason: string | null;
	triggeringFlagId: string | null;
	updatedAt: Date | null;
}

/** No row means good standing. Every reader depends on this being the default. */
const GOOD_STANDING: Standing = {
	status: 'none',
	reason: null,
	triggeringFlagId: null,
	updatedAt: null
};

/**
 * This member's standing in one domain.
 *
 * Absence of a row is the overwhelmingly common case and reads as `none`, so
 * callers never branch on "no row" — only on the status.
 */
export async function getStanding(userId: string, scope: StandingScope): Promise<Standing> {
	const [row] = await db
		.select({
			status: memberStanding.status,
			reason: memberStanding.reason,
			triggeringFlagId: memberStanding.triggeringFlagId,
			updatedAt: memberStanding.updatedAt
		})
		.from(memberStanding)
		.where(and(eq(memberStanding.userId, userId), eq(memberStanding.scope, scope)))
		.limit(1);

	return row ?? GOOD_STANDING;
}

/**
 * Every scope at once, for surfaces that show the whole picture — the staff
 * user detail page, the member overview.
 *
 * One query rather than one per scope: the three cards on `/staff/users/[id]`
 * used to be three round-trips because they were three tables.
 */
export async function getStandings(userId: string): Promise<Record<StandingScope, Standing>> {
	const rows = await db
		.select({
			scope: memberStanding.scope,
			status: memberStanding.status,
			reason: memberStanding.reason,
			triggeringFlagId: memberStanding.triggeringFlagId,
			updatedAt: memberStanding.updatedAt
		})
		.from(memberStanding)
		.where(eq(memberStanding.userId, userId));

	const byScope = Object.fromEntries(
		standingScopes.map((scope) => [scope, GOOD_STANDING])
	) as Record<StandingScope, Standing>;

	for (const { scope, ...standing } of rows) byScope[scope] = standing;
	return byScope;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface SetStandingParams {
	userId: string;
	scope: StandingScope;
	status: StandingStatus;
	/**
	 * Who decided. Required, and that is the point: there is no argument shape
	 * here that expresses a member changing their own standing. A member's own
	 * preference about being reachable is `user.acceptsDirectMessages`, which
	 * this service cannot write.
	 */
	staffId: string;
	reason?: string | null;
	/** The upheld report, when a report is what caused this. */
	flagId?: string | null;
}

/**
 * Write a member's standing in one scope. Idempotent — staff upholding a second
 * report simply restates it with the newer reason.
 */
export async function setStanding(params: SetStandingParams): Promise<void> {
	if (!standingScopeConfig[params.scope].statuses.includes(params.status)) {
		throw new StandingStatusNotAllowedError(params.scope, params.status);
	}

	const values = {
		status: params.status,
		reason: params.reason ? params.reason.slice(0, STANDING_REASON_MAX) : null,
		triggeringFlagId: params.flagId ?? null,
		updatedByUserId: params.staffId,
		updatedAt: new Date()
	};

	await db
		.insert(memberStanding)
		.values({ userId: params.userId, scope: params.scope, ...values })
		.onConflictDoUpdate({
			target: [memberStanding.userId, memberStanding.scope],
			set: values
		});
}

export interface RestrictStandingParams {
	userId: string;
	scope: StandingScope;
	flagId: string;
	staffId: string;
	reason?: string | null;
}

/**
 * What an upheld report costs. Called from `flag-service` and nowhere else —
 * a dismissed report deliberately costs nothing, and no other path in the app
 * puts someone on probation by itself.
 */
export async function restrictStanding(params: RestrictStandingParams): Promise<void> {
	await setStanding({ ...params, status: 'restricted' });
}

/**
 * Give a member their standing back in one scope.
 *
 * An UPDATE, never an upsert. Restoring someone who was never restricted has to
 * be a no-op: absence of a row means good standing, so inserting one here would
 * manufacture a history that did not happen.
 *
 * `reason` and `triggeringFlagId` are left alone so "why was I in review?" is
 * still answerable afterwards — flipping the status is what marks it forgiven.
 *
 * The shape (`{ userId, scope, staffId }`) is deliberately what an appeal needs
 * to call; see `docs/specs/shipped/member-standing-spec.md`.
 */
export async function restoreStanding(params: {
	userId: string;
	scope: StandingScope;
	staffId: string;
}): Promise<void> {
	await db
		.update(memberStanding)
		.set({ status: 'none', updatedByUserId: params.staffId, updatedAt: new Date() })
		.where(and(eq(memberStanding.userId, params.userId), eq(memberStanding.scope, params.scope)));
}

// ---------------------------------------------------------------------------
// Flags → scope
// ---------------------------------------------------------------------------

/**
 * Which standing an upheld report about this thing costs, or null for the ones
 * that cost nothing.
 *
 * **Not the identity function**, which is the whole reason it is a named thing
 * rather than a switch inline in `resolveFlag`: an `event` report only touches
 * standing when the event is a member's community listing. CMC and band gigs
 * have no member to hold responsible.
 *
 * Pure on purpose — it takes the event source the caller has already fetched
 * rather than querying for it, so the mapping is testable on its own.
 */
export function scopeForFlag(
	entityType: FlagEntityType,
	context: { eventSource?: string | null } = {}
): StandingScope | null {
	switch (entityType) {
		case 'event':
			return context.eventSource === 'community' ? 'community_event' : null;
		case 'suggestion':
			return 'suggestion';
		case 'inbox_thread':
			return 'messaging';
		// `member_profile` and `band_profile` cost nobody anything on uphold —
		// staff act on the profile itself. Giving them a scope would mean a column
		// no code reads.
		case 'member_profile':
		case 'band_profile':
			return null;
	}
}
