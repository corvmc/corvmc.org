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
