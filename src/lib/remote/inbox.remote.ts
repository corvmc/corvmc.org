import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, form, command, getRequestEvent } from '$app/server';
import { verifyTurnstile } from '$lib/server/turnstile';
import { requireStaff, requireUser, listUsersWithCapability } from '$lib/server/authorization';
import { getUserContact } from '$lib/server/user/user-service';
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
	listThreadsByContactEmail,
	undoLastDisposition,
	countThreadFacets,
	getThreadContext,
	addThreadTag,
	removeThreadTag,
	getDailyScope
} from '$lib/server/inbox/thread-service';
import type { ListThreadsFilters } from '$lib/server/inbox/thread-service';
import {
	getAllChannelConfigs,
	getEnabledChannels,
	updateChannelConfig as updateChannelConfigSvc
} from '$lib/server/inbox/channel-config-service';
import { addOutboundMessage, addNote } from '$lib/server/inbox/message-service';
import {
	listSavedViews,
	createSavedView,
	deleteSavedView
} from '$lib/server/inbox/saved-view-service';
import { jsonObjectField } from '$lib/utils/zod-json';
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
import { DEFAULT_TIMEZONE, inboxChannels, inboxViews } from '$lib/config';
import type { InboxView } from '$lib/config';

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

/**
 * The four tabs, and what each one is in database terms.
 *
 * Open and Snoozed are the two halves of the live queue, and complementary by
 * construction — `needsUsCondition` and `parkedCondition` in thread-service,
 * not a status equality each. Open is what needs a human, the same set the
 * staff nav badge counts; Snoozed is everything on a timer, whether the timer
 * is a date or a contact who owes us an answer. The two views nobody is waiting
 * on keep the old newest-first order.
 */
const VIEWS = {
	open: { queue: 'needs-us', sort: 'waiting' },
	snoozed: { queue: 'parked', sort: 'waiting' },
	resolved: { status: 'resolved', sort: 'recent' },
	all: { sort: 'recent' }
} as const satisfies Record<
	InboxView,
	Omit<ListThreadsFilters, 'channel' | 'assignedToUserId' | 'search'>
>;

/**
 * The `view` param, wherever it is read.
 *
 * `awaiting` was a view of its own until Snoozed absorbed it, and is mapped
 * rather than rejected: a saved view's filters are replayed verbatim out of the
 * row they were stored in and no migration rewrites them, so a 400 here is a
 * tab that has stopped working. Same mapping as `parseView` on the client,
 * which is what tidies the URL up afterwards.
 */
const viewParam = z.preprocess((v) => (v === 'awaiting' ? 'snoozed' : v), z.enum(inboxViews));

const threadFiltersSchema = z.object({
	view: viewParam.optional(),
	channel: z.enum(inboxChannels).optional(),
	/** A staff user id, or the sentinels `mine` / `unassigned`. */
	assigned: z.string().optional(),
	/** A `contactSubjects` value, or `other` for everything outside it. */
	subject: z.string().optional(),
	/** The range control. 0 means the control is at its floor — no filter. */
	waitingDays: z.coerce.number().int().min(0).max(90).optional(),
	search: z.string().optional(),
	page: z.coerce.number().int().min(1).optional()
});

type ThreadFilters = z.infer<typeof threadFiltersSchema>;

/**
 * What a saved view is allowed to remember. The same keys the URL carries, so
 * saving a view and bookmarking the page are the same act — and a filter added
 * later is one line here rather than a migration.
 */
const savedViewFiltersSchema = z.object({
	view: viewParam.optional(),
	channel: z.enum(inboxChannels).optional(),
	assigned: z.string().max(64).optional(),
	subject: z.string().max(64).optional(),
	waitingDays: z.number().int().min(0).max(90).optional(),
	q: z.string().max(200).optional()
});

/**
 * The wire filters as the service understands them.
 *
 * Shared by the list and the facet counts so the numbers beside an option and
 * the rows behind it can never be answering different questions. `staffId`
 * resolves the `mine` sentinel, which is the one filter whose meaning depends
 * on who is asking.
 */
function toServiceFilters(filters: ThreadFilters, staffId: string): ListThreadsFilters {
	// `undefined` leaves the filter off entirely; `null` is the IS NULL branch in
	// listThreads, so the two cannot be collapsed.
	const assignedToUserId =
		filters.assigned === undefined
			? undefined
			: filters.assigned === 'unassigned'
				? null
				: filters.assigned === 'mine'
					? staffId
					: filters.assigned;

	return {
		...VIEWS[filters.view ?? 'open'],
		channel: filters.channel,
		assignedToUserId,
		subject: filters.subject,
		// Zero is the range control resting at its floor, which is not a filter.
		waitingAtLeastDays: filters.waitingDays ? filters.waitingDays : undefined,
		search: filters.search
	};
}

export const getInboxThreads = query(threadFiltersSchema, async (filters) => {
	const staff = await requireStaff();
	return listThreads(toServiceFilters(filters, staff.id), {
		page: filters.page ?? 1,
		pageSize: 25
	});
});

/**
 * What each filter option would leave on screen.
 *
 * The panel's own query, awaited where the panel is rendered rather than in the
 * page: the queue paints without it, and it is keyed by the same filters the
 * list is — see `custom/no-concurrent-remote-queries`.
 */
export const getInboxFilterCounts = query(threadFiltersSchema, async (filters) => {
	const staff = await requireStaff();
	return countThreadFacets(toServiceFilters(filters, staff.id));
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

/**
 * Who a thread can be handed to.
 *
 * `inbox.reply`, not "is staff": you may only assign a conversation to someone
 * who is able to answer it.
 */
export const getAssignableStaff = query(z.void(), async () => {
	await requireStaff();
	return listUsersWithCapability('inbox.reply');
});

// ---------------------------------------------------------------------------
// Staff forms
// ---------------------------------------------------------------------------

const replySchema = z.object({
	threadId: z.string().min(1),
	body: z.string().trim().min(1).max(10000),
	/**
	 * Where the thread goes once the reply is away. Carried by the clicked send
	 * button, so it cannot be left unanswered.
	 *
	 * `.optional()` rather than a default in the schema, because a `.transform()`
	 * or a default here breaks the `fields` inference the composer's hidden
	 * inputs are built from. Missing means `wait`, which is what
	 * `addOutboundMessage` does on its own.
	 */
	disposition: z.enum(['wait', 'resolve', 'keep_open']).optional()
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

	// `addOutboundMessage` already leaves the thread waiting on the contact, so
	// `wait` needs nothing further. The other two overrule it: resolving closes
	// the conversation outright, and keeping it open is staff saying they expect
	// to come back to this themselves.
	if (data.disposition === 'resolve') await updateStatus(data.threadId, 'resolved');
	else if (data.disposition === 'keep_open') await setAwaitingReply(data.threadId, false);

	void getInboxThread(data.threadId).refresh();
	void getInboxThreadCounts().refresh();
	// Replying marks the thread as waiting on the contact, which takes it out of
	// the nav badge — so the badge has to be recounted here as well.
	void getInboxUnreadCount().refresh();
	void getStaffLayout().refresh();
	return { success: true };
});

const noteSchema = z.object({
	threadId: z.string().min(1),
	body: z.string().trim().min(1).max(5000),
	/**
	 * Hand the thread over in the same action as the note explaining why.
	 *
	 * "@Miranda can you take this one?" and assigning it to Miranda are one
	 * decision; making them two is how a thread ends up mentioned at somebody
	 * who was never actually given it. Empty means the note is just a note.
	 */
	assignToUserId: z.string().optional()
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

	if (data.assignToUserId) {
		await assignThreadSvc(data.threadId, data.assignToUserId);
		if (data.assignToUserId !== staff.id) await notifyAssignee(data.threadId, data.assignToUserId);
	}

	void getInboxThread(data.threadId).refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Thread tags
// ---------------------------------------------------------------------------
// Staff annotations on a conversation, distinct from the inquiry type: the type
// is what the contact said they were writing about, a tag is what we decided
// this is after reading it.

export const getInboxThreadContext = query(z.string().min(1), async (id) => {
	await requireStaff();
	const context = await getThreadContext(id);
	if (!context) throw error(404, 'Thread not found');
	return context;
});

const tagSchema = z.object({
	threadId: z.string().min(1),
	tag: z.string().trim().min(1).max(40)
});

export const addInboxThreadTag = command(tagSchema, async ({ threadId, tag }) => {
	await requireStaff();
	await addThreadTag(threadId, tag);
	void getInboxThreadContext(threadId).refresh();
});

export const removeInboxThreadTag = command(tagSchema, async ({ threadId, tag }) => {
	await requireStaff();
	await removeThreadTag(threadId, tag);
	void getInboxThreadContext(threadId).refresh();
});

const assignSchema = z.object({
	threadId: z.string().min(1),
	userId: z
		.string()
		.optional()
		.transform((v) => v || null)
});

/**
 * Tell someone a conversation is theirs now.
 *
 * Shared by the assign control and by an internal note that hands the thread
 * over in the same action — a mention with no notification is how a thread ends
 * up assigned to someone who never found out.
 */
async function notifyAssignee(threadId: string, userId: string) {
	// A direct read, not a scan of the assignable list: `assignThread` has
	// already validated the assignee, so this is a lookup rather than a second
	// authorization rule, and walking a list to fetch one row was the wrong
	// shape regardless.
	const assignee = await getUserContact(userId);
	const thread = await getThread(threadId);
	if (!assignee || !thread) return;

	await dispatch({
		type: 'inbox_assigned',
		userId: assignee.id,
		userEmail: assignee.email,
		title: 'A conversation was assigned to you',
		body: thread.subject ?? thread.contactName ?? undefined,
		href: `/staff/inbox/${threadId}`
	});
}

export const assignThread = form(assignSchema, async (data) => {
	const staff = await requireStaff();
	await assignThreadSvc(data.threadId, data.userId);

	// Notify the assignee, unless they assigned the thread to themselves.
	if (data.userId && data.userId !== staff.id) await notifyAssignee(data.threadId, data.userId);

	void getInboxThread(data.threadId).refresh();
	return { success: true };
});

/**
 * The four ways a conversation leaves the queue, as one call.
 *
 * A `command` rather than four `form`s. These are raised from a keyboard
 * shortcut, a dropdown item and a toast as often as from a button, none of
 * which is a form submission — and the previous shape (two forms, four `.for()`
 * instances, a modal wrapping a select) took two interactions to do the one
 * thing anyone does from here. One entry point is also what lets every one of
 * them capture an undo snapshot without four chances to forget.
 *
 * `wait` is not a status. It sets the awaiting-reply marker, which moves the
 * thread from Open to Awaiting reply — the same state replying applies, reached
 * deliberately. It is the manual path for an answer given somewhere the inbox
 * cannot see: a phone call, a hallway, someone's own phone.
 */
const disposeSchema = z.object({
	threadId: z.string().min(1),
	action: z.enum(['resolve', 'snooze', 'wait', 'reopen']),
	/** `YYYY-MM-DD` from the snooze menu. Only meaningful when snoozing. */
	snoozedUntil: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional()
});

export const disposeThread = command(disposeSchema, async ({ threadId, action, snoozedUntil }) => {
	await requireStaff();

	if (action === 'wait') {
		await setAwaitingReply(threadId, true);
	} else if (action === 'reopen') {
		// Reopening clears the marker as well as the status — `updateStatus` does
		// that, and it is the point: staff saying this needs an answer now.
		await updateStatus(threadId, 'open');
	} else {
		// A calendar date means "put this back in the queue that morning", so it
		// resolves against club time rather than UTC midnight — otherwise snoozing
		// until tomorrow wakes the thread at 5pm today.
		await updateStatus(
			threadId,
			action === 'resolve' ? 'resolved' : 'snoozed',
			snoozedUntil ? buildDateInTz(snoozedUntil, '08:00', DEFAULT_TIMEZONE) : undefined
		);
	}

	void getInboxThread(threadId).refresh();
	void getInboxThreadCounts().refresh();
	void getInboxUnreadCount().refresh();
	// The staff nav badge counts open threads, so disposing of one from the
	// detail page has to refresh the layout too or the sidebar keeps the old
	// number.
	void getStaffLayout().refresh();
});

/**
 * Put the thread back the way the last disposition found it.
 *
 * A `command` rather than a `form`: it is raised by a toast button and by ⌘Z,
 * neither of which is a form submission, and it takes no input beyond the id.
 * Silent when there is nothing to undo — pressing ⌘Z twice is not an error.
 */
export const undoThreadDisposition = command(z.string().min(1), async (threadId) => {
	await requireStaff();
	const undone = await undoLastDisposition(threadId);
	if (!undone) return { undone: false };

	void getInboxThread(threadId).refresh();
	void getInboxThreadCounts().refresh();
	void getInboxUnreadCount().refresh();
	// Same reason as updateThreadStatus: the nav badge lives in the layout and
	// counts open threads, so restoring one has to recount it.
	void getStaffLayout().refresh();
	return { undone: true };
});

/**
 * The threads a Daily session would walk, in the order it would walk them.
 *
 * One query returning ids rather than whole threads: the session loads each
 * conversation as it reaches it, so a seven-thread run is seven small reads
 * spread over the session instead of one large one before it starts.
 */
export const getInboxDailyScope = query(z.void(), async () => {
	await requireStaff();
	return getDailyScope();
});

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------
// A filter combination somebody wants back tomorrow, rendered as an extra tab.
// Every one of these is scoped to the caller by the service, which constrains
// on the owner id rather than trusting the view id to belong to whoever sent it.

export const getInboxSavedViews = query(z.void(), async () => {
	const staff = await requireStaff();
	return listSavedViews(staff.id);
});

const savedViewSchema = z.object({
	name: z.string().trim().min(1).max(60),
	/**
	 * The filters, as the same JSON the URL carries. `jsonObjectField` rather
	 * than a `.transform()`: a `JSON.parse` throw inside a transform escapes
	 * validation as a 500, and this arrives from a form field.
	 */
	filters: jsonObjectField().pipe(savedViewFiltersSchema)
});

export const saveInboxView = form(savedViewSchema, async (data) => {
	const staff = await requireStaff();
	await createSavedView(staff.id, data.name, data.filters);
	void getInboxSavedViews().refresh();
	return { success: true };
});

export const removeInboxView = command(z.string().min(1), async (id) => {
	const staff = await requireStaff();
	await deleteSavedView(staff.id, id);
	void getInboxSavedViews().refresh();
});

// ---------------------------------------------------------------------------
// Channel configuration
// ---------------------------------------------------------------------------

// Channel configuration is staff-only and not feature-gated. There was a
// `staffInbox` flag, but it never guarded anything — the inbox is staff-only and
// the staff panel ignored flags by design — so it was retired rather than wired
// up.
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
