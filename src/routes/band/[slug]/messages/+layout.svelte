<script lang="ts">
	import { page } from '$app/state';
	import InboxShell from '$lib/components/inbox/InboxShell.svelte';
	import EnquiryList from './EnquiryList.svelte';

	let { children } = $props();

	const threadOpen = $derived(page.route.id === '/band/[slug]/messages/[id]');
</script>

<InboxShell {threadOpen} {children}>
	{#snippet list()}
		<EnquiryList />
	{/snippet}
</InboxShell>
