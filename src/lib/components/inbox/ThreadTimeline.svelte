<script lang="ts">
	/**
	 * Messages and internal notes on one chronological spine.
	 *
	 * Notes used to render as a block after every message, so a note about the
	 * second message appeared below the ninth. They are also deliberately lighter
	 * than messages: no bubble, no card, just an indented annotation — a note is a
	 * margin scribble on the conversation, not a turn in it.
	 */
	import { IconNote } from '@tabler/icons-svelte';
	import { formatDateTime } from '$lib/utils/format';

	type Message = {
		id: string;
		direction: 'inbound' | 'outbound' | 'peer';
		body: string;
		authorName: string | null;
		authorUserId?: string | null;
		createdAt: Date;
	};

	type Note = {
		id: string;
		body: string;
		authorName: string | null;
		createdAt: Date;
	};

	let {
		messages,
		notes = [],
		contactName,
		viewerUserId
	}: {
		messages: Message[];
		/** Staff-only annotations. Omitted entirely on member-facing timelines. */
		notes?: Note[];
		contactName?: string | null;
		/**
		 * Whose point of view the timeline is drawn from — whose messages sit on
		 * the right. Usually the person reading, which is the only rule that
		 * works when both parties are members. Staff triaging a reported DM pass
		 * the *reporter* instead, so the conversation reads from the point of
		 * view of whoever raised it.
		 *
		 * Omitted, sides fall back to inbound/outbound, i.e. the org's point of
		 * view: that is the staff inbox, where a colleague's reply must still
		 * read as ours. A 'peer' message has no org side, so it lands left.
		 */
		viewerUserId?: string | null;
	} = $props();

	// No direction fallback when viewerUserId is set: a message with no author
	// account was written by someone else, and that is exactly what puts a staff
	// reply on the left for the member reading it.
	const isOwn = (message: Message) =>
		viewerUserId ? message.authorUserId === viewerUserId : message.direction === 'outbound';

	// Only used when a message has no stored author name. The member-facing
	// timeline passes no contactName — naming the other side after the thread's
	// contact would have staff replies signed with the member's own name.
	const ownName = $derived(viewerUserId ? 'You' : 'Staff');
	const otherName = $derived(contactName ?? (viewerUserId ? 'CorvMC' : 'Contact'));

	type Entry =
		| { kind: 'message'; at: number; message: Message }
		| { kind: 'note'; at: number; note: Note };

	const entries = $derived.by(() => {
		const combined: Entry[] = [
			...messages.map((message) => ({
				kind: 'message' as const,
				at: new Date(message.createdAt).getTime(),
				message
			})),
			...notes.map((note) => ({
				kind: 'note' as const,
				at: new Date(note.createdAt).getTime(),
				note
			}))
		];
		return combined.sort((a, b) => a.at - b.at);
	});
</script>

<div class="space-y-4">
	{#each entries as entry (entry.kind === 'message' ? `m${entry.message.id}` : `n${entry.note.id}`)}
		{#if entry.kind === 'message'}
			{@const msg = entry.message}
			{@const own = isOwn(msg)}
			<div class="chat {own ? 'chat-end' : 'chat-start'}">
				<div class="chat-header mb-1">
					{msg.authorName ?? (own ? ownName : otherName)}
					<time class="ml-2 text-xs opacity-50">{formatDateTime(msg.createdAt)}</time>
				</div>
				<!-- Bodies arrive as plain text; without this every multi-paragraph
				     email collapsed into one run-on block. -->
				<div class="chat-bubble whitespace-pre-wrap {own ? 'chat-bubble-primary' : ''}">
					{msg.body}
				</div>
			</div>
		{:else}
			{@const note = entry.note}
			<div class="border-base-content/20 mx-6 border-l-2 border-dashed py-1 pl-3">
				<div class="flex items-center gap-1.5 text-xs opacity-50">
					<IconNote size={13} />
					{note.authorName ?? 'Staff'} · {formatDateTime(note.createdAt)}
				</div>
				<div class="text-muted whitespace-pre-wrap">{note.body}</div>
			</div>
		{/if}
	{:else}
		<p class="py-8 text-center text-muted">No messages in this conversation yet.</p>
	{/each}
</div>
