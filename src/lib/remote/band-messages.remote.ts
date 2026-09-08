/**
 * The band's own inbox: the booking enquiries its public form collects.
 *
 * Every function here guards with `requireGroupRole(ref, 'admin')` first. The
 * ref is a lookup key, not a capability — the guard resolves the band from it
 * and then checks the caller's role on the *resolved* band — and everything
 * downstream takes the band id it returns, never one the client supplied.
 *
 * The list queries resolve the band from its slug; **the mutations resolve it
 * from the thread**, via `bandOfThread`. That is deliberate. A slug and a thread
 * id arriving together are two claims that have to agree, and nothing would make
 * them: a caller could name their own band and someone else's thread, and the
 * guard would pass on the first while the service was handed the second. One
 * key, derived from the row being written, cannot disagree with itself.
 *
 * Owner and admin, not every member. Answering an enquiry commits the act to a
 * date and a price, the same line Press Kit and Edit Profile already draw. The
 * tech rider is the deliberate exception on the other side of it.
 *
 * Not tier-gated. The booking form is free for every act — see
 * `band-contact.remote.ts` — and an inbox the band cannot read would make it
 * worse than the email it replaced.
 */
import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, form, command } from '$app/server';
import { requireGroupRole } from '$lib/server/group/group-context';
import {
	listBandThreads,
	getBandThread,
	replyToBandThread,
	setBandThreadStatus,
	markBandThreadRead,
	bandOfThread,
	BAND_THREAD_STATUSES
} from '$lib/server/inbox/band-service';
import { getBandLayout } from '$lib/remote/layout.remote';

/**
 * Resolve the band that owns a thread, then authorise against *that* band.
 *
 * Throws the same 404 for a thread on another channel, a thread belonging to
 * another band, and a thread that does not exist — a caller has no business
 * telling those apart, and the second one would confirm a uuid.
 */
async function requireThreadBand(threadId: string) {
	const groupId = await bandOfThread(threadId);
	if (!groupId) throw error(404, 'Conversation not found');
	return requireGroupRole({ id: groupId }, 'admin');
}

export const getBandConversations = query(
	z.object({ slug: z.string().min(1), page: z.coerce.number().int().min(1).optional() }),
	async ({ slug, page }) => {
		const ctx = await requireGroupRole({ slug }, 'admin');
		return listBandThreads(ctx.group.id, ctx.user.id, { page: page ?? 1, pageSize: 25 });
	}
);

export const getBandConversation = query(
	z.object({ slug: z.string().min(1), threadId: z.string().min(1) }),
	async ({ slug, threadId }) => {
		const ctx = await requireGroupRole({ slug }, 'admin');
		const thread = await getBandThread(threadId, ctx.group.id);
		if (!thread) throw error(404, 'Conversation not found');
		return { ...thread, bandName: ctx.group.name };
	}
);

const sendBandReplySchema = z.object({
	threadId: z.string().min(1),
	body: z.string().trim().min(1).max(10000)
});

export const sendBandReply = form(sendBandReplySchema, async (data, issue) => {
	const ctx = await requireThreadBand(data.threadId);

	const result = await replyToBandThread({
		threadId: data.threadId,
		groupId: ctx.group.id,
		userId: ctx.user.id,
		userName: ctx.user.name,
		body: data.body
	});

	if (!result) {
		invalid(issue.body('This enquiry is closed. Reopen it to reply.'));
	}

	void getBandConversation({ slug: ctx.group.slug, threadId: data.threadId }).refresh();
	void getBandLayout(ctx.group.slug).refresh();
	return { success: true };
});

const setBandConversationStatusSchema = z.object({
	threadId: z.string().min(1),
	status: z.enum(BAND_THREAD_STATUSES)
});

export const setBandConversationStatus = form(
	setBandConversationStatusSchema,
	async (data, issue) => {
		const ctx = await requireThreadBand(data.threadId);

		const changed = await setBandThreadStatus(data.threadId, ctx.group.id, data.status);
		if (!changed) invalid(issue.threadId('That enquiry is no longer available.'));

		void getBandConversation({ slug: ctx.group.slug, threadId: data.threadId }).refresh();
		void getBandLayout(ctx.group.slug).refresh();
		return { success: true };
	}
);

// A command rather than a write inside getBandConversation: queries are cached
// and deduped, so a write hidden in a read fires an unpredictable number of
// times.
export const markBandConversationRead = command(z.string().min(1), async (threadId) => {
	const ctx = await requireThreadBand(threadId);
	await markBandThreadRead(threadId, ctx.group.id, ctx.user.id);
	void getBandLayout(ctx.group.slug).refresh();
	// The unread dot in the list pane is cleared by the caller, not here: the
	// list is paginated and queries cache per argument, so this handler cannot
	// name the entry the page is holding.
});
