import type { inboxChannels, inboxThreadStatuses } from '$lib/config';

/**
 * One row of the unified conversation list.
 *
 * Here rather than beside the query that builds it because the list component
 * renders it, and a component must not import from `$lib/server` — not even a
 * type, which would put a server module on the client's import graph.
 */
export interface UnifiedConversation {
	id: string;
	channel: (typeof inboxChannels)[number];
	subject: string | null;
	preview: string | null;
	status: (typeof inboxThreadStatuses)[number];
	lastMessageAt: Date | null;
	unread: boolean;
	/** A direct request the viewer has not accepted. Never true for a group thread. */
	pending: boolean;
	/** Null for the viewer's own threads; the group's id for a group one. */
	groupId: string | null;
	/** Who the thread is with — the other member, or the booker who wrote in. */
	counterpartName: string | null;
	/** Which inbox the row is in, for the label. Null is the viewer's own. */
	groupName: string | null;
}
