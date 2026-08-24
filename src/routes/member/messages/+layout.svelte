<script lang="ts">
	import { page } from '$app/state';
	import InboxShell from '$lib/components/inbox/InboxShell.svelte';
	import ConversationList from './ConversationList.svelte';

	let { children } = $props();

	const threadOpen = $derived(page.route.id === '/member/messages/[id]');
</script>

<InboxShell {threadOpen} {children}>
	{#snippet list()}
		<ConversationList />
	{/snippet}
</InboxShell>
