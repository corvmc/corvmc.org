<script lang="ts">
	import { page } from '$app/state';
	import InboxShell from '$lib/components/inbox/InboxShell.svelte';
	import InboxList from './InboxList.svelte';

	let { children } = $props();

	const threadOpen = $derived(page.route.id === '/staff/inbox/[id]');
</script>

<InboxShell {threadOpen} {children}>
	{#snippet list()}
		<InboxList />
	{/snippet}
</InboxShell>
