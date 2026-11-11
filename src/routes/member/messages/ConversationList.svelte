<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The member's conversations — staff threads and member threads in one list.
	 *
	 * One list is possible because both kinds are participant-based, so
	 * `listMemberConversations` returns them from a single query. Rows are
	 * conversation cards rather than table rows: a table wants columns of
	 * comparable values, and what matters here is who, what they last said, and
	 * whether it is waiting on you.
	 */
	import { page } from '$app/state';
	import DataList from '#lib/components/ui/DataList.svelte';
	import ConversationRows from '#lib/components/inbox/ConversationRows.svelte';
	import ComposeAction from './ComposeAction.svelte';
	import { getMyMessages } from '#lib/remote/direct-messages.remote.js';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { goto } from '$app/navigation';
	import { getMemberLayoutContext } from '../layout-context';
	import { conversationList } from './list-state.svelte';

	// The page number is shared module state, not local: the thread pane is a
	// sibling, and it has to be able to refresh this list at the page it is
	// actually showing. See list-state.svelte.ts.
	/**
	 * The inbox in the URL, mirrored into local state rather than read back.
	 * A shallow `goto` updates neither `page.url` nor the router, so a filter read
	 * straight off the URL lags the control by a navigation.
	 */
	let inbox = $state(page.url.searchParams.get('inbox') ?? 'all');

	function chooseInbox(next: string) {
		inbox = next;
		conversationList.page = 1;
		const url = new URL(page.url.href);
		if (next === 'all') url.searchParams.delete('inbox');
		else url.searchParams.set('inbox', next);
		void goto(url, { replace: true, reset: false });
	}

	const result = $derived(getMyMessages({ page: conversationList.page, inbox }));
	// The member layout above already holds this; re-awaiting it here was a second remote query in
	// flight in this component. See `member/layout-context.ts`.
	const memberLayout = getMemberLayoutContext();
	const layout = $derived(memberLayout.current);

	/**
	 * The selector's options come off the layout the panel already holds, not a
	 * query of their own — `custom/no-concurrent-remote-queries`, and the same
	 * two lists the sidebar draws its My Bands and My Groups from.
	 *
	 * Every active membership is offered: a group's chat is every member's, so
	 * a plain bandmate gets its inbox even with no enquiries in it.
	 */
	const inboxes = $derived(
		[...layout.userBands, ...layout.userGroups]
			.map((g) => ({ slug: g.slug, name: g.name }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	// Two different offs. The feature flag is the collective's (#907); this is
	// the member's own switch, and an inbox empty because of it reads as one
	// nobody has written to unless it says otherwise.
	const dmsOff = $derived(layout.features.directMessages && !layout.acceptsDirectMessages);
	const emptyMessage = $derived(
		dmsOff
			? m.member_messages_conversation_list_direct_messages_switched_o_body()
			: layout.features.directMessages
				? m.member_messages_conversation_list_use_message_member_message_body()
				: m.member_messages_conversation_list_use_message_staff_above_st_body()
	);
</script>

<div class="flex min-h-0 flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h1 class="text-xl font-bold">{m.member_messages_conversation_list_messages_title()}</h1>
		<div class="flex flex-wrap gap-2">
			<ComposeAction
				canMessageMembers={layout.features.directMessages && layout.acceptsDirectMessages}
			/>
		</div>
	</div>

	<!--
		Requests are deliberately absent from the nav badge — an unconsented message
		must not follow anyone around the site — so this is the only place that says
		some are waiting. `getMemberLayout` has returned the count all along with
		nothing rendering it.
	-->
	{#if layout.pendingRequests > 0}
		<p class="text-muted text-sm">
			{m.member_messages_conversation_list_message_requests_waiting_text({
				pendingRequests: layout.pendingRequests
			})}
		</p>
	{/if}

	<!-- One list, narrowed rather than split. `groupId` is the inbox, so the
	     options are "everything you can read", your own, then one per group —
	     and a group you only belong to offers its chat, not its bookings. -->
	{#if inboxes.length > 0}
		<Select
			size="sm"
			aria-label={m.member_messages_conversation_list_aria_label()}
			value={inbox}
			onchange={(e: Event) => chooseInbox((e.currentTarget as HTMLSelectElement).value)}
		>
			<option value="all">{m.member_messages_conversation_list_all_inboxes_label()}</option>
			<option value="own">{m.member_messages_conversation_list_just_mine_label()}</option>
			{#each inboxes as box (box.slug)}
				<option value={box.slug}>{box.name}</option>
			{/each}
		</Select>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto">
		<!-- The copy names the control that is actually on screen. "Start a
		     conversation" pointed at Message a Member, which only renders when the
		     direct-messages feature is on — so with it off the page promised
		     something it did not offer (#907). -->
		<DataList
			{result}
			emptyTitle={m.member_messages_conversation_list_empty_title()}
			empty={emptyMessage}
			actionLabel={dmsOff ? m.member_messages_conversation_list_action_label() : undefined}
			actionHref={dmsOff ? '/member/account' : undefined}
			onpage={(p) => (conversationList.page = p)}
		>
			{#snippet children(conversations)}
				<ConversationRows rows={conversations} hrefFor={(id) => `/member/messages/${id}`} />
			{/snippet}
		</DataList>
	</div>
</div>
