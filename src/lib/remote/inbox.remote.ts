import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, form, command, getRequestEvent } from '$app/server';
import { verifyTurnstile } from '$lib/server/turnstile';
import { requireStaff, requireUser, listStaffUsers } from '$lib/server/authorization';
import { dispatch } from '$lib/server/notification/dispatcher';
import { handleContactForm } from '$lib/server/inbox/inbound-handlers';
import { getStaffLayout, getMemberLayout } from '$lib/remote/layout.remote';
import {
	listThreads,
	getThread,
	assignThread as assignThreadSvc,
	updateStatus,
	setAwaitingReply,
	getUnresolvedCount,
	countThreadsByStatus,
	listThreadsByContactEmail
} from '$lib/server/inbox/thread-service';
import {
	getAllChannelConfigs,
	getEnabledChannels,
	updateChannelConfig as updateChannelConfigSvc
} from '$lib/server/inbox/channel-config-service';
import { addOutboundMessage, addNote } from '$lib/server/inbox/message-service';
import {
	listPortalThreads,
	countOpenPortalThreads,
	countPortalUnread,
	getPortalThread,
	startPortalConversation,
	replyToPortalThread,
	markPortalThreadRead,
	MAX_OPEN_PORTAL_THREADS
} from '$lib/server/inbox/portal-service';
import { submitContactFormSchema } from '$lib/server/db/schema/inbox';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE, inboxChannels, inboxThreadStatuses } from '$lib/config';

// ---------------------------------------------------------------------------
// Public forms
// ---------------------------------------------------------------------------

export const submitContactForm = form(submitContactFormSchema, async (data, issue) => {
	const ip = getRequestEvent().request.headers.get('CF-Connecting-IP');
	if (!(await verifyTurnstile(data.turnstileToken, ip))) {
		invalid(issue.turnstileToken('Verification failed. Please try again.'));
	}
	await handleContactForm(data);
	return { success: true };
});

// ---------------------------------------------------------------------------
// Staff queries
// ---------------------------------------------------------------------------

const threadFiltersSchema = z.object({
	status: z.enum(inboxThreadStatuses).optional(),
	channel: z.enum(inboxChannels).optional(),
	/** A staff user id, or the sentinels `mine` / `unassigned`. */
	assigned: z.string().optional(),
	/** Who the conversation is waiting on: `yes` them, `no` us. */
	awaiting: z.enum(['yes', 'no']).optional(),
	search: z.string().optional(),
	page: z.coerce.number().int().min(1).optional()
});

export const getInboxThreads = query(threadFiltersSchema, async (filters) => {
	const staff = await requireStaff();

	// `undefined` leaves the filter off entirely; `null` is the IS NULL branch in
	// listThreads, so the two cannot be collapsed.
	const assignedToUserId =
		filters.assigned === undefined
			? undefined
			: filters.assigned === 'unassigned'
				? null
				: filters.assigned === 'mine'
					? staff.id
					: filters.assigned;

	return listThreads(
		{
			status: filters.status,
			channel: filters.channel,
			assignedToUserId,
			awaitingReply: filters.awaiting === undefined ? undefined : filters.awaiting === 'yes',
			search: filters.search
		},
		{ page: filters.page ?? 1, pageSize: 25 }
	);
});

export const getInboxThreadCounts = query(z.void(), async () => {
	await requireStaff();
	return countThreadsByStatus();
});

export const getInboxThread = query(z.string(), async (id) => {
	await requireStaff();
	const thread = await getThread(id);
	if (!thread) throw error(404, 'Thread not found');
	return thread;
});

export const getInboxUnreadCount = query(z.void(), async () => {
	await requireStaff();
	return getUnresolvedCount();
});

export const getAssignableStaff = query(z.void(), async () => {
	await requireStaff();
	return listStaffUsers();
});

// ---------------------------------------------------------------------------
// Staff forms
// ---------------------------------------------------------------------------

const replySchema = z.object({
	threadId: z.string().min(1),
	body: z.string().trim().min(1).max(10000)
});

export const replyToThread = form(replySchema, async (data) => {
	const staff = await requireStaff();
	const thread = await getThread(data.threadId);
	if (!thread) throw error(404, 'Thread not found');

	await addOutboundMessage({
		threadId: data.threadId,
		body: data.body,
		authorUserId: staff.id,
		authorName: staff.name
	});

	void getInboxThread(data.threadId).refresh();
	// Replying marks the thread as waiting on the contact, which takes it out of
	// the nav badge — so the badge has to be recounted here as well.
	void getInboxUnreadCount().refresh();
	void getStaffLayout().refresh();
	return { success: true };
});

const noteSchema = z.object({
	threadId: z.string().min(1),
	body: z.string().trim().min(1).max(5000)
});

export const addThreadNote = form(noteSchema, async (data) => {
	const staff = await requireStaff();
	const thread = await getThread(data.threadId);
	if (!thread) throw error(404, 'Thread not found');

	await addNote({
		threadId: data.threadId,
		authorUserId: staff.id,
		body: data.body
	});

	void getInboxThread(data.threadId).refresh();
	return { success: true };
});

const assignSchema = z.object({
	threadId: z.string().min(1),
	userId: z
		.string()
		.optional()
		.transform((v) => v || null)
});

export const assignThread = form(assignSchema, async (data) => {
	const staff = await requireStaff();
	await assignThreadSvc(data.threadId, data.userId);

	// Notify the assignee, unless they assigned the thread to themselves.
	if (data.userId && data.userId !== staff.id) {
		const assignee = (await listStaffUsers()).find((u) => u.id === data.userId);
		const thread = await getThread(data.threadId);
		if (assignee && thread) {
			await dispatch({
				type: 'inbox_assigned',
				userId: assignee.id,
				userEmail: assignee.email,
				title: 'A conversation was assigned to you',
				body: thread.subject ?? thread.contactName ?? undefined,
				href: `/staff/inbox/${data.threadId}`
			});
		}
	}

	void getInboxThread(data.threadId).refresh();
	return { success: true };
});

const statusSchema = z.object({
	threadId: z.string().min(1),
	status: z.enum(inboxThreadStatuses),
	/** `YYYY-MM-DD` from the snooze calendar; only meaningful when snoozing. */
	snoozedUntil: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional()
});

export const updateThreadStatus = form(statusSchema, async (data) => {
	await requireStaff();

	// A calendar date means "put this back in the queue that morning", so it
	// resolves against club time rather than UTC midnight — otherwise snoozing
	// until tomorrow wakes the thread at 5pm today.
	const snoozedUntil = data.snoozedUntil
		? buildDateInTz(data.snoozedUntil, '08:00', DEFAULT_TIMEZONE)
		: undefined;

	await updateStatus(data.threadId, data.status, snoozedUntil);
	void getInboxThread(data.threadId).refresh();
	void getInboxThreadCounts().refresh();
	void getInboxUnreadCount().refresh();
	// The staff nav badge counts open threads, so resolving from the detail page
	// has to refresh the layout too or the sidebar keeps the old number.
	void getStaffLayout().refresh();
	return { success: true };
});

// No `.transform()` on `awaiting`: a transform in a form() schema breaks the
// `fields` inference the button's hidden inputs are built from.
const awaitingSchema = z.object({
	threadId: z.string().min(1),
	awaiting: z.enum(['true', 'false'])
});

/**
 * The manual half of the awaiting-reply marker — replying sets it on its own.
 * Staff reach for this when the answer happened off the platform, or when a
 * conversation they marked needs their attention again after all.
 */
export const setThreadAwaiting = form(awaitingSchema, async (data) => {
	await requireStaff();
	await setAwaitingReply(data.threadId, data.awaiting === 'true');

	void getInboxThread(data.threadId).refresh();
	// The marker is what the nav badge counts, so both it and the layout that
	// renders it have to be recounted — same reason as updateThreadStatus.
	void getInboxUnreadCount().refresh();
	void getStaffLayout().refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Channel configuration
// ---------------------------------------------------------------------------

// Channel configuration is staff-only but deliberately *not* feature-gated: it
// lives on the settings page next to the staffInbox flag itself, so requiring
// the flag to read it would make the inbox impossible to configure before
// turning it on.
export const getInboxChannelConfigs = query(z.void(), async () => {
	await requireStaff();
	return getAllChannelConfigs();
});

export const getInboxEnabledChannels = query(z.void(), async () => {
	await requireStaff();
	return getEnabledChannels();
});

const channelConfigSchema = z.object({
	channel: z.enum(inboxChannels),
	enabled: z.enum(['true', 'false']).transform((v) => v === 'true')
});

export const updateInboxChannelConfig = form(channelConfigSchema, async (data) => {
	await requireStaff();
	await updateChannelConfigSvc(data.channel, data.enabled);
	void getInboxChannelConfigs().refresh();
	void getInboxEnabledChannels().refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Member portal
// ---------------------------------------------------------------------------
// A member's own conversations with staff. Remote functions are the only guard
// on these — nothing upstream has checked anything — so each one hands the
// caller's id to a portal-service function that enforces participation in SQL.
// None of them can reach an internal note: the portal service never queries
// inbox_note, which is why they don't reuse getThread().

export const getMyConversations = query(
	z.object({ page: z.coerce.number().int().min(1).optional() }).optional(),
	async (args) => {
		const user = requireUser();
		return listPortalThreads(user.id, { page: args?.page ?? 1, pageSize: 25 });
	}
);

export const getMyConversation = query(z.string(), async (id) => {
	const user = requireUser();
	const thread = await getPortalThread(id, user.id);
	// Same 404 whether the thread is someone else's, is not a portal thread, or
	// does not exist — the caller has no business telling those apart.
	if (!thread) throw error(404, 'Conversation not found');
	return thread;
});

const startConversationSchema = z.object({
	subject: z.string().trim().min(1).max(200),
	body: z.string().trim().min(1).max(10000)
});

export const startConversation = form(startConversationSchema, async (data, issue) => {
	const user = requireUser();

	const result = await startPortalConversation({
		userId: user.id,
		userName: user.name,
		userEmail: user.email,
		subject: data.subject,
		body: data.body
	});

	if (!result) {
		invalid(
			issue.subject(
				`You already have ${MAX_OPEN_PORTAL_THREADS} conversations open. Continue one of those, or wait for staff to close it.`
			)
		);
	}

	void getMyConversations().refresh();
	void getMemberLayout().refresh();
	return { threadId: result.threadId };
});

const sendConversationMessageSchema = z.object({
	threadId: z.string().min(1),
	body: z.string().trim().min(1).max(10000)
});

export const sendConversationMessage = form(sendConversationMessageSchema, async (data, issue) => {
	const user = requireUser();

	const result = await replyToPortalThread({
		threadId: data.threadId,
		userId: user.id,
		userName: user.name,
		body: data.body
	});

	if (!result) {
		invalid(issue.body('This conversation is closed. Start a new one instead.'));
	}

	void getMyConversation(data.threadId).refresh();
	void getMyConversations().refresh();
	void getMemberLayout().refresh();
	return { success: true };
});

// A command rather than a write inside getMyConversation: queries are cached and
// deduped, so a write hidden in a read fires an unpredictable number of times.
export const markConversationRead = command(z.string(), async (id) => {
	const user = requireUser();
	await markPortalThreadRead(id, user.id);
	void getMemberLayout().refresh();
	// The unread dot in the list pane is cleared by the caller, not here: the
	// list is paginated and queries cache per argument, so this handler cannot
	// name the entry the page is holding.
});

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserThreads = query(
	z.object({ userId: z.string(), email: z.string() }),
	async ({ userId, email }) => {
		await requireStaff();
		const [portal, open, unread, byEmail] = await Promise.all([
			listPortalThreads(userId, { page: 1, pageSize: 10 }),
			countOpenPortalThreads(userId),
			countPortalUnread(userId),
			// Threads that predate the account, or came in by email rather than
			// through the portal, have no participant row and are invisible to
			// listPortalThreads. Matched on the denormalized contact address.
			email ? listThreadsByContactEmail(email, { page: 1, pageSize: 10 }) : null
		]);

		const portalIds = new Set(portal.rows.map((t) => t.id));

		return {
			portal: portal.rows,
			open,
			unread,
			// Deduped against the portal list: a portal thread whose contact
			// address is also theirs would otherwise appear in both sections.
			byEmail: (byEmail?.rows ?? []).filter((t) => !portalIds.has(t.id))
		};
	}
);
