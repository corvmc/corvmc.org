import { hasEventEnded } from '$lib/utils/event-time';
import type { EventStatus } from '$lib/server/db/schema/event';

/** Why an event takes no RSVP, or null when it does. */
export type RsvpClosedReason = 'unpublished' | 'cancelled' | 'past' | 'ticketed';

export interface RsvpAvailabilityInput {
	status: EventStatus | string;
	ticketingEnabled: boolean;
	startsAt: Date;
	endsAt: Date | null;
}

/**
 * The one rule for whether an event takes an RSVP, shared by the interstitial
 * and the `rsvpToEvent` write. Order matters only for the message shown:
 * an unpublished event must not say more about itself than that.
 */
export function rsvpClosedReason(
	evt: RsvpAvailabilityInput,
	now: Date = new Date()
): RsvpClosedReason | null {
	if (evt.status === 'cancelled') return 'cancelled';
	if (evt.status !== 'published') return 'unpublished';
	if (evt.ticketingEnabled) return 'ticketed';
	if (hasEventEnded(evt.startsAt, evt.endsAt, now)) return 'past';
	return null;
}
