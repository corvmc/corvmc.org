import type { EntityRef, MemberRef } from './entity';

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

/** Paid premium or the free base tier. A staff position is not a membership. */
export type MemberStatus = 'sustaining' | 'member';

export const memberStatusLabels: Record<MemberStatus, string> = {
	sustaining: 'Sustaining',
	member: 'Member'
};

/**
 * What every row of a `Roster` carries, whatever query produced it. A page's
 * own row type extends this with its columns; `toRosterPerson` builds it.
 */
export interface RosterPerson {
	/** The user id: the side panel's key and the record link. */
	personId: string;
	/** Name, avatar and email, for `EntityIdentity`. */
	member: MemberRef;
	email: string | null;
	memberStatus: MemberStatus;
}
