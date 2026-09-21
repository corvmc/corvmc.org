import * as z from 'zod';
import { query } from '$app/server';
import { command, form } from './_remote';
import { requireGroupRole } from '$lib/server/group/group-context';
import {
	getGroupChat,
	postToGroupChat,
	markGroupChatRead,
	groupOfChatThread,
	listGroupTopics,
	createGroupTopic,
	setRoomMute as setRoomMuteState
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
	const { group, user } = await requireGroupRole({ slug }, 'member');
	return getGroupChat(group.id, undefined, user.id);
});

/** The group's topics, with this reader's unread marks (#1301). */
export const getGroupChatTopics = query(slugSchema, async (slug) => {
	const { group, user, role } = await requireGroupRole({ slug }, 'member');
	// Leadership decides whether a `leadership` room reads as writable. The
	// list marks the rest read-only rather than hiding them: a member reads
	// every room, and only posting is restricted (#1304).
	return listGroupTopics(group.id, user.id, role === 'owner' || role === 'admin');
});

/**
 * One topic, by thread id.
 *
 * The gate starts from the thread rather than a slug, the same way posting
 * does: `groupOfChatThread` returns null for anything that is not a group
 * chat, so a caller cannot reach an enquiry or a DM by knowing its id, and
 * cannot name their own group to read someone else's topic.
 */
export const getGroupChatTopic = query(z.string().min(1), async (threadId) => {
	const chatGroup = await groupOfChatThread(threadId);
	if (!chatGroup) error(404, 'No such conversation');

	const { group, user } = await requireGroupRole({ id: chatGroup.id }, 'member');
	return getGroupChat(group.id, threadId, user.id);
});

/**
 * Open a named topic. Any active member, like posting — a room the whole
 * group reads is not an admin's to ration.
 */
export const createGroupChatTopic = form(
	z.object({
		slug: slugSchema,
		subject: z.string().trim().min(1, 'Give the topic a name').max(80)
	}),
	async (data) => {
		const { group } = await requireGroupRole({ slug: data.slug }, 'member');
		try {
			// A chat topic, always. An announcement is made on the announcements
			// page, which is the surface that knows about drafts and publishing —
			// a flag here would be a second way to make one, with no control to
			// set it and no draft step. `createGroupTopic` takes the policies for
			// `announcement-service` to use.
			const threadId = await createGroupTopic(group.id, data.subject, {
				postPolicy: 'members',
				notifyPolicy: 'in_app'
			});
			await getGroupChatTopics(data.slug).refresh();
			return { success: true, threadId };
		} catch (err) {
			throw mapDomainError(err);
		}
	}
);

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

			const { user, group, role } = await requireGroupRole({ id: chatGroup.id }, 'member');
			await postToGroupChat({
				groupId: chatGroup.id,
				groupName: group.name,
				userId: user.id,
				userName: user.name,
				body: data.body,
				threadId: data.threadId,
				isLeader: role === 'owner' || role === 'admin'
			});
			// Both: the topic the message landed in, and the list that badges it.
			await getGroupChatTopic(data.threadId).refresh();
			await getGroupChatTopics(chatGroup.slug).refresh();
			return { success: true };
		} catch (err) {
			throw mapDomainError(err);
		}
	}
);

/**
 * Reading a topic clears its dot.
 *
 * A `command`, not a `form`: the caller is an effect on the open topic rather
 * than a button. Nothing called the form version at all, so before topics the
 * dot only ever cleared by posting — survivable when there was one room,
 * wrong the moment there are several.
 */
export const markGroupChatSeen = command(z.string().min(1), async (threadId) => {
	const chatGroup = await groupOfChatThread(threadId);
	if (!chatGroup) error(404, 'No such conversation');

	const { user } = await requireGroupRole({ id: chatGroup.id }, 'member');
	await markGroupChatRead(threadId, user.id);
	await getGroupChatTopics(chatGroup.slug).refresh();
	return { success: true };
});

/**
 * Silence one room, or let it speak again.
 *
 * The gate is the thread's own group, as posting is, and the reader is the
 * session's: a member may only ever mute a room for themselves, so there is
 * no `userId` field to forge. An intent enum rather than a boolean — a
 * cleared checkbox reads as untouched in a remote form.
 */
export const setRoomMute = form(
	z.object({ threadId: z.string().min(1), intent: z.enum(['mute', 'unmute']) }),
	async (data) => {
		const chatGroup = await groupOfChatThread(data.threadId);
		if (!chatGroup) error(404, 'No such conversation');

		const { user } = await requireGroupRole({ id: chatGroup.id }, 'member');
		await setRoomMuteState(data.threadId, user.id, data.intent === 'mute');
		await getGroupChatTopics(chatGroup.slug).refresh();
		return { success: true };
	}
);
