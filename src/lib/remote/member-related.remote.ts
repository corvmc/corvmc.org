import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { requireUser } from '#lib/server/authorization.js';
import { currentListingViewer } from '#lib/server/event/listing-viewer.js';
import { requireProgramRole } from '#lib/server/group/group-context.js';
import {
	isPublicListing,
	memberRelatedShifts,
	memberRelatedTasks
} from '#lib/server/task/member-related.js';

/**
 * `RelatedTasks` and `RelatedShifts` on member pages (#2630 phase 4). Their own
 * guards, never the staff cards' capabilities: a group's cards are for its
 * roster, an event's for anyone who may read its member page.
 */

const memberSubject = z.object({ type: z.enum(['group', 'event']), id: z.string().min(1) });
type MemberSubject = z.infer<typeof memberSubject>;

async function requireMemberSubject(s: MemberSubject) {
	if (s.type === 'group') return (await requireProgramRole({ id: s.id }, 'member')).user;
	const user = requireUser();
	if (!(await isPublicListing(s.id, await currentListingViewer()))) error(404, 'Event not found');
	return user;
}

export const getMemberRelatedTasks = query(
	memberSubject.extend({ includeDone: z.boolean().optional() }),
	async ({ includeDone, ...s }) => {
		const user = await requireMemberSubject(s);
		return memberRelatedTasks(s, user.id, { includeDone });
	}
);

export const getMemberRelatedShifts = query(memberSubject, async (s) => {
	const user = await requireMemberSubject(s);
	return { groups: await memberRelatedShifts(s, user.id) };
});
