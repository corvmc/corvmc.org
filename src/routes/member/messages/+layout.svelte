<script lang="ts">
	import { page } from '$app/state';
	import ListDetailShell from '#lib/components/ui/ListDetailShell.svelte';
	import ConversationList from './ConversationList.svelte';

	let { children } = $props();

	const threadOpen = $derived(page.route.id === '/member/messages/[id]');
</script>

<ListDetailShell open={threadOpen} {children}>
	{#snippet list()}
		<ConversationList />
	{/snippet}
</ListDetailShell>
