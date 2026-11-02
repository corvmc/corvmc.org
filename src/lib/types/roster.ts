import type { MemberRef } from './entity';

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
