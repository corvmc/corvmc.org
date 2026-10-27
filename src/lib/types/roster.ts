import type { EntityRef } from './entity';

/**
 * One person on a list of who is coming: an RSVP today, and the shape a
 * generic Roster (#1994) is meant to take — tickets, crew and sign-ups alike.
 */
export interface RosterRow {
	id: string;
	person: EntityRef;
	/** How to reach them about this event, as they gave it. */
	contact: string;
	/** When they joined the list. */
	at: Date;
}
