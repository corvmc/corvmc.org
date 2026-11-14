/** An event's visibility, as `eventVisibilities` in the event schema lists it. */
export type ReachVisibility = 'public' | 'members' | 'group';

export interface ReachAudience {
	systemKey: string | null;
	allowOptIn: boolean;
}

/**
 * The audiences that can reach people an event's visibility hides it from
 * (#2773). A static list or an opt-in list holds non-members; a group event's
 * only safe audience is its own ticket holders and RSVPs. Shared by the editor's
 * warning and the audit entry written at send, so both name the same audiences.
 */
export function audiencesBeyondVisibility<A extends ReachAudience>(
	visibility: ReachVisibility,
	audiences: A[]
): A[] {
	if (visibility === 'public') return [];
	if (visibility === 'members') return audiences.filter((a) => !a.systemKey || a.allowOptIn);
	return audiences.filter((a) => a.systemKey !== 'event-interest');
}

/**
 * An audience's recipient count in a campaign's editor (#2772). "Event audience"
 * stores no members: it resolves to the chosen show's ticket holders and RSVPs,
 * so its stored count is always 0 and the show's is the one to add.
 */
export function audienceCount(
	a: { systemKey: string | null; subscriberCount: number },
	eventCount: number
): number {
	return a.systemKey === 'event-interest' ? eventCount : a.subscriberCount;
}
