<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '#lib/utils/format.js';
	import { getLocalResourceTips } from '#lib/remote/local-resources.remote.js';
	import ResourceTabs from '../ResourceTabs.svelte';

	const data = $derived(await getLocalResourceTips());
</script>

<PageHeader title={m.staff_local_resources()} subtitle={m.staff_outreach()} />

<PageContent>
	<ResourceTabs active="tips" tipCount={data.tips.length} />

	{#if data.tips.length === 0}
		<EmptyState
			title={m.staff_local_resources_tips_no_tips_waiting()}
			description={m.staff_local_resources_tips_description()}
		/>
	{:else}
		<!-- A table: short fields, and the decision lives on the listing's own page. -->
		<Table>
			{#snippet head()}
				<th class="cell-primary">{m.staff_name()}</th>
				<th class="col-support">{m.staff_category()}</th>
				<th class="col-support">{m.staff_from()}</th>
				<th class="whitespace-nowrap">{m.staff_sent()}</th>
			{/snippet}
			{#each data.tips as tip (tip.id)}
				{@const href = resolve(`/staff/local-resources/${tip.id}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="cell-primary"><a class="font-medium link-hover" {href}>{tip.name}</a></td>
					<td class="col-support whitespace-nowrap">{tip.categoryName}</td>
					<td class="col-support cell-text truncate">{tip.submitterEmail ?? '—'}</td>
					<td class="whitespace-nowrap">{formatDateShort(tip.createdAt)}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
