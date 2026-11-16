import { resolve } from '$app/paths';
import type { NeedsYouItem } from '#lib/types/needs-you.js';
import type { GroupMemberStatus, GroupRole } from '#lib/server/db/schema/group.js';

export interface BandNeedingMembers {
	id: string;
	name: string;
	slug: string;
	role: GroupRole;
	status: GroupMemberStatus;
	memberCount: number;
}

/**
 * A band the member owns with nobody else on its roster (#3050). Only the
 * owner can invite, and a member who left halfway through setup has no other
 * way back to it from the dashboard.
 */
export function bandSetupNeedsYouItems(bands: BandNeedingMembers[]): NeedsYouItem[] {
	return bands
		.filter((b) => b.role === 'owner' && b.status === 'active' && b.memberCount <= 1)
		.map((b) => ({
			id: `band-no-members:${b.id}`,
			kind: 'band-no-members' as const,
			title: `Invite members to ${b.name}`,
			href: resolve(`band/${b.slug}/members`),
			label: 'Invite member',
			dueAt: null,
			rank: 13
		}));
}
