<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { getLocalResourceTips } from '$lib/remote/local-resources.remote';
	import ResourceTabs from '../ResourceTabs.svelte';

	const data = $derived(await getLocalResourceTips());
</script>

<PageHeader title="Local Resources" subtitle="Outreach" />

<PageContent>
	<ResourceTabs active="tips" tipCount={data.tips.length} />

	{#if data.tips.length === 0}
		<EmptyState
			title="No tips waiting"
			description="Tips sent from the public directory land here until you publish or return them."
		/>
	{:else}
		<!-- A table: short fields, and the decision lives on the listing's own page. -->
		<Table>
			{#snippet head()}
				<th class="cell-primary">Name</th>
				<th class="col-support">Category</th>
				<th class="col-support">From</th>
				<th class="whitespace-nowrap">Sent</th>
			{/snippet}
			{#each data.tips as tip (tip.id)}
				{@const href = resolve(`/staff/local-resources/${tip.id}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="cell-primary"><a class="font-medium link-hover" {href}>{tip.name}</a></td>
					<td class="col-support whitespace-nowrap">{tip.categoryName}</td>
					<td class="col-support truncate">{tip.submitterEmail ?? '—'}</td>
					<td class="whitespace-nowrap">{formatDateShort(tip.createdAt)}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
