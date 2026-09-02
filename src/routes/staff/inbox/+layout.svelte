<script lang="ts">
	import { page } from '$app/state';
	import InboxShell from '$lib/components/inbox/InboxShell.svelte';
	import InboxList from './InboxList.svelte';
	import FilterPanel from './FilterPanel.svelte';
	import SaveViewDialog from './SaveViewDialog.svelte';
	import { filters, filterPanel, toQuery, reset } from './filters.svelte';

	let { children } = $props();

	// The panel takes the conversation pane rather than covering the list: you
	// narrow a list by watching it change, and a modal over the thing you are
	// filtering hides the only feedback the panel gives.
	const threadOpen = $derived(page.route.id === '/staff/inbox/[id]' || filterPanel.open);

	let saving = $state(false);
</script>

<InboxShell {threadOpen}>
	{#snippet list()}
		<InboxList />
	{/snippet}
	{#if filterPanel.open}
		<FilterPanel
			bind:view={filters.view}
			bind:assigned={filters.assigned}
			bind:subject={filters.subject}
			bind:waitingDays={filters.waitingDays}
			filters={toQuery()}
			onreset={reset}
			onsave={() => (saving = true)}
			onclose={() => (filterPanel.open = false)}
		/>
	{:else}
		{@render children()}
	{/if}
</InboxShell>

<SaveViewDialog bind:open={saving} />
