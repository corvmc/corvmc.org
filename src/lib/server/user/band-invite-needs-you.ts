import { resolve } from '$app/paths';
import type { NeedsYouItem } from '#lib/types/needs-you.js';

/** A group name is required: an invitation that names no group gives nothing to decide on (#3052). */
export interface InviteNeedingYou {
	name: string;
}

/**
 * One item for every waiting invitation. A single invitation names its group;
 * several collapse to a count, the names going in the detail line.
 */
export function bandInviteNeedsYouItems(invites: InviteNeedingYou[]): NeedsYouItem[] {
	if (invites.length === 0) return [];
	const names = invites.map((i) => i.name);
	return [
		{
			id: 'band-invitation',
			kind: 'band-invitation',
			title: names.length === 1 ? `Invite from ${names[0]}` : `${names.length} band invites`,
			detail: names.length === 1 ? undefined : names.join(', '),
			href: resolve('member/bands'),
			label: 'Answer',
			dueAt: null,
			rank: 10
		}
	];
}
