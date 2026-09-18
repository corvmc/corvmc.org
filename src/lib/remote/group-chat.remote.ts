import * as z from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireGroupRole } from '$lib/server/group/group-context';
import {
	getGroupChat,
	postToGroupChat,
	markGroupChatRead,
	groupOfChatThread
} from '$lib/server/inbox/group-chat-service';
import { error } from '@sveltejs/kit';
import { DIRECT_MESSAGE_BODY_MAX } from '$lib/config';
import { mapDomainError } from '$lib/server/errors';

/**
 * A group's shared thread — every active member reads and writes it.
 *
 * `requireGroupRole({ slug }, 'member')` is the whole gate, and it is here
 * because a remote function is its own endpoint. `'member'`, not `'admin'`, is
 * the entire difference from the band's enquiry inbox. No `allowStaff`: a chat
 * is not a support surface (#1252).
 */

const slugSchema = z.string().min(1);

export const getGroupChatThread = query(slugSchema, async (slug) => {
	const { group } = await requireGroupRole({ slug }, 'member');
	return getGroupChat(group.id);
});

/**
 * `{ threadId, body }` is what `ThreadComposer` posts, so the gate starts from
 * the thread. `groupOfChatThread` returns null for anything that is not a
 * group chat, so this cannot reach an enquiry.
 */
export const postGroupChatMessage = form(
	z.object({
		threadId: z.string().min(1),
		body: z.string().trim().min(1).max(DIRECT_MESSAGE_BODY_MAX)
	}),
	async (data) => {
		try {
			const chatGroup = await groupOfChatThread(data.threadId);
			if (!chatGroup) error(404, 'No such conversation');

			const { user, group } = await requireGroupRole({ id: chatGroup.id }, 'member');
			await postToGroupChat({
				groupId: chatGroup.id,
				groupName: group.name,
				userId: user.id,
				userName: user.name,
				body: data.body
			});
			await getGroupChatThread(chatGroup.slug).refresh();
			return { success: true };
		} catch (err) {
			throw mapDomainError(err);
		}
	}
);

export const markGroupChatSeen = form(z.object({ slug: slugSchema }), async (data) => {
	const { group, user } = await requireGroupRole({ slug: data.slug }, 'member');
	await markGroupChatRead(group.id, user.id);
	return { success: true };
});
