import { query, form } from '$app/server';
import { error, invalid } from '@sveltejs/kit';
import * as z from 'zod';
import { requireUser } from '$lib/server/authorization';
import { requireFeature } from '$lib/server/feature-flags';
import {
	startDirectThread,
	replyToDirectThread,
	acceptDirectThread,
	declineDirectThread,
	listMemberConversations,
	getDirectThread,
	counterpartOf
} from '$lib/server/inbox/direct-service';
import { getPortalThread } from '$lib/server/inbox/portal-service';
import {
	blockUser,
	unblockUser,
	listBlockedBy,
	getMessagingState,
	setAcceptsDirectMessages
} from '$lib/server/moderation/moderation-service';
import { getMemberLayout } from './layout.remote';
import {
	MAX_PENDING_SENT_REQUESTS,
	MAX_UNRESOLVED_REPORTS,
	DIRECT_MESSAGE_BODY_MAX
} from '$lib/config';
import {
	createFlag,
	countUnresolvedReportsBy,
	FLAG_REASON_MAX,
	FLAG_DESCRIPTION_MAX
} from '$lib/server/flag/flag-service';
import { updateStatus } from '$lib/server/inbox/thread-service';

// ---------------------------------------------------------------------------
// Member↔member conversations
// ---------------------------------------------------------------------------
// Remote functions are the only guard on these — SvelteKit dispatches a remote
// call before any route load runs — so each one hands the caller's id to a
// direct-service function that enforces participation in SQL.
//
// None of these can reach an internal note, and none of them are reachable by
// staff. A reported conversation is read through the flags queue instead.
//
// Note what the mutations below do NOT do: refresh the conversation list.
// Queries are cached per argument and the list is paginated, so a handler here
// cannot name the entry the page is holding — it would refresh one nothing
// renders, which is the bug these calls used to have when they pointed at
// `getMyDirectThreads()`. The pages refresh in `onsuccess`, where the page
// number is in scope. See `src/routes/member/messages/list-state.svelte.ts`.

/** Everything in the member's Messages list: staff threads and member threads. */
export const getMyMessages = query(
	z.object({ page: z.coerce.number().int().min(1).optional() }).optional(),
	async (args) => {
		const user = requireUser();
		// No entity ref here, unlike every other list: #234 made this a two-pane
		// inbox whose whole row is the anchor, with an active state and a channel
		// icon. An identity's own link inside that row would be an anchor inside an
		// anchor, so `ConversationList` owns its markup and the tier stays out.
		return listMemberConversations(user.id, { page: args?.page ?? 1, pageSize: 25 });
	}
);

/**
 * One conversation from the member's Messages list, whichever kind it is.
 *
 * A discriminated union rather than one merged shape, because the two have
 * genuinely different rules: a staff thread is read by portal-service (which
 * masks staff ids and never touches notes), a member thread by direct-service
 * (which does the opposite on ids, for good reason). Merging them into one
 * reader would mean one function holding both rules conditionally.
 *
 * Same 404 for anything the caller is not party to, either way.
 */
export const getMyMessageThread = query(z.string(), async (id) => {
	const user = requireUser();

	const direct = await getDirectThread(id, user.id);
	if (direct) return { kind: 'direct' as const, ...direct };

	const portal = await getPortalThread(id, user.id);
	if (portal) return { kind: 'staff' as const, ...portal };

	throw error(404, 'Conversation not found');
});

const startDirectSchema = z.object({
	recipientId: z.string().min(1),
	body: z.string().trim().min(1).max(DIRECT_MESSAGE_BODY_MAX)
});

/**
 * Note what this does *not* report: "they blocked you", "they don't take
 * messages", "no such member". All of those come back as a plain success. The
 * sender learning which one applies is exactly what the consent model exists to
 * prevent — a declined request has to be indistinguishable from an unopened one.
 */
export const startDirectConversation = form(startDirectSchema, async (data, issue) => {
	await requireFeature('directMessages');
	const user = requireUser();

	const result = await startDirectThread({
		senderId: user.id,
		senderName: user.name,
		recipientId: data.recipientId,
		body: data.body
	});

	if (result.status === 'restricted') {
		// The one branch that *is* explicit. A member is entitled to know they
		// cannot start conversations, and to read the staff note that says why.
		invalid(
			issue.body(
				result.reason
					? `You cannot start new conversations right now: ${result.reason}`
					: 'You cannot start new conversations right now. Contact staff if you think this is a mistake.'
			)
		);
	}
	if (result.status === 'too_many_pending') {
		invalid(
			issue.body(
				`You have ${MAX_PENDING_SENT_REQUESTS} message requests still waiting for a reply. You can send more once some of those are answered.`
			)
		);
	}
	if (result.status === 'rate_limited') {
		invalid(issue.body('You have started a lot of conversations today. Try again tomorrow.'));
	}

	return { success: true };
});

const sendDirectSchema = z.object({
	threadId: z.string().min(1),
	body: z.string().trim().min(1).max(DIRECT_MESSAGE_BODY_MAX)
});

export const sendDirectMessage = form(sendDirectSchema, async (data, issue) => {
	await requireFeature('directMessages');
	const user = requireUser();

	const result = await replyToDirectThread({
		threadId: data.threadId,
		userId: user.id,
		userName: user.name,
		body: data.body
	});

	if (!result) {
		invalid(issue.body('You can no longer write in this conversation.'));
	}

	void getMyMessageThread(data.threadId).refresh();
	void getMemberLayout().refresh();
	return { success: true };
});

const threadIdSchema = z.object({ threadId: z.string().min(1) });

export const acceptDirectRequest = form(threadIdSchema, async (data, issue) => {
	await requireFeature('directMessages');
	const user = requireUser();

	const accepted = await acceptDirectThread(data.threadId, user.id);
	if (!accepted) {
		invalid(issue.threadId('This request is no longer available.'));
	}

	void getMyMessageThread(data.threadId).refresh();
	void getMemberLayout().refresh();
	return { success: true };
});

/**
 * Declining closes the conversation and blocks the sender, who is never told.
 * Report does the same thing and files a flag as well — see reportDirectThread
 * in inbox.remote.ts, which shares the underlying path deliberately.
 */
export const declineDirectRequest = form(threadIdSchema, async (data, issue) => {
	await requireFeature('directMessages');
	const user = requireUser();

	const declined = await declineDirectThread(data.threadId, user.id);
	if (!declined) {
		invalid(issue.threadId('This request is no longer available.'));
	}

	void getMemberLayout().refresh();
	return { success: true };
});

/** Blocking from inside an open conversation, rather than off a request. */
export const blockFromThread = form(threadIdSchema, async (data, issue) => {
	await requireFeature('directMessages');
	const user = requireUser();

	// Participation is the authorisation: counterpartOf only answers for a thread
	// the caller is genuinely on.
	const other = await counterpartOf(data.threadId, user.id);
	if (!other) {
		invalid(issue.threadId('Conversation not found.'));
	}

	await blockUser({ blockerUserId: user.id, blockedUserId: other, source: 'manual' });

	void getMyMessageThread(data.threadId).refresh();
	return { success: true };
});

export const getMyBlocks = query(async () => {
	const user = requireUser();
	return listBlockedBy(user.id);
});

export const unblockMember = form(z.object({ userId: z.string().min(1) }), async (data) => {
	const user = requireUser();
	await unblockUser(user.id, data.userId);
	void getMyBlocks().refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Reporting a conversation
// ---------------------------------------------------------------------------

/**
 * Report a conversation to staff.
 *
 * Uses the existing content-flag system — same table, same `/staff/flags`
 * queue, same resolve flow. It is a separate remote from `submitFlag` only
 * because a conversation report has two requirements the shared path must not
 * inherit: the reporter has to be in the conversation, and reporting has to
 * block the other person straight away.
 *
 * Note this deliberately works on a **pending request**, not just an accepted
 * conversation. `getDirectThread` has no acceptedAt condition precisely so that
 * Report can sit next to Accept and Decline — a bad first message is the main
 * thing this button is for.
 *
 * Report therefore does everything Decline does, and files a flag as well.
 */
const reportDirectSchema = z.object({
	threadId: z.string().min(1),
	reason: z.string().trim().min(1).max(FLAG_REASON_MAX),
	description: z.string().trim().max(FLAG_DESCRIPTION_MAX).optional()
});

export const reportDirectThread = form(reportDirectSchema, async (data, issue) => {
	await requireFeature('directMessages');
	await requireFeature('contentFlags');
	const reporter = requireUser();

	// Participation IS the authorisation, and it reuses the member's own read
	// path — so "not a participant", "not a direct thread" and "does not exist"
	// all come back as the same 404.
	const thread = await getDirectThread(data.threadId, reporter.id);
	if (!thread || !thread.counterpartId) throw error(404, 'Conversation not found');

	// Counted in the database rather than rated per day: a member having a
	// genuinely bad week can report again as soon as staff clear the queue, while
	// someone filing junk to bury it stops until staff look.
	if ((await countUnresolvedReportsBy(reporter.id)) >= MAX_UNRESOLVED_REPORTS) {
		invalid(
			issue.reason(
				'You have several reports still waiting for staff. You can send more once those are reviewed.'
			)
		);
	}

	await createFlag({
		entityType: 'inbox_thread',
		entityId: data.threadId,
		reportedByUserId: reporter.id,
		reportedByName: reporter.name,
		reason: data.reason,
		description: data.description
	});

	// The reporter should not have to wait on a staff queue to stop hearing from
	// someone. Same block and same closed thread as Decline.
	await blockUser({
		blockerUserId: reporter.id,
		blockedUserId: thread.counterpartId,
		source: 'reported'
	});
	await updateStatus(data.threadId, 'resolved');

	void getMemberLayout().refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Messaging standing
// ---------------------------------------------------------------------------

/**
 * What the member sees on their own account page: their own switch, and
 * separately any restriction staff or a report has put on them.
 */
export const getMyMessagingStanding = query(async () => {
	const user = requireUser();
	return getMessagingState(user.id);
});

/**
 * A member switching their own messaging off, or back on.
 *
 * Writes `user.acceptsDirectMessages` and nothing else, which is the whole
 * reason this needs no guard: the preference is theirs outright, and it lives
 * nowhere near `member_standing`. A restricted member may still set it, and
 * setting it cannot lift the restriction — see `docs/specs/shipped/member-standing-spec.md`.
 */
export const setMyMessaging = form(z.object({ enabled: z.enum(['on', 'off']) }), async (data) => {
	const user = requireUser();
	await setAcceptsDirectMessages(user.id, data.enabled === 'on');
	void getMyMessagingStanding().refresh();
	return { success: true };
});
