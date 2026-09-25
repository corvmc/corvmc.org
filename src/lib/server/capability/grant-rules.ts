import { grantRuleFor, type Capability } from '$lib/config';

/**
 * What a guard is acting on, when it is acting on something.
 *
 * `eventId` admits a volunteer-role grant for that event. `groupId` names the
 * committee that owns the record, and `projectId` the project whose committees
 * an `'owned'` grant reaches. All come from the record being acted on, never
 * from the request.
 */
export type CapabilityScope = {
	eventId?: string | null;
	groupId?: string | null;
	/** Admits `'owned'` grants of every committee taking part in this project. */
	projectId?: string | null;
};

/** One active committee seat and the allowlisted capabilities it carries. */
export type CommitteeGrant = { groupId: string; capabilities: string[] };

/** Keep only entries the allowlist still lets `carrier` hold. */
export function allowlisted(caps: readonly string[], carrier: 'role' | 'committee'): string[] {
	return caps.filter((c) => grantRuleFor(c)?.[carrier] !== undefined);
}

/**
 * Do these seats allow `cap`? An `'org'` grant counts anywhere; an `'owned'`
 * one only when `scope.groupId` names the seat's own committee.
 */
export function committeeAllows(
	seats: readonly CommitteeGrant[],
	cap: Capability,
	scope?: CapabilityScope
): boolean {
	const reach = grantRuleFor(cap)?.committee;
	if (!reach) return false;
	return seats.some(
		(s) => s.capabilities.includes(cap) && (reach === 'org' || s.groupId === scope?.groupId)
	);
}
