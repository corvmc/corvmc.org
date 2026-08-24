<script lang="ts">
	import { getCampaigns } from '$lib/remote/marketing.remote';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';

	let statusFilter = $state('');
	let campaigns = $derived(await getCampaigns({ status: statusFilter || undefined }));
</script>

<PageHeader title="Campaigns" subtitle="Marketing">
	<Button href="/staff/marketing/campaigns/new" variant="default" size="sm">New Campaign</Button>
</PageHeader>
<PageContent>
	<div class="mb-4 flex gap-2">
		<Select size="sm" aria-label="Status" bind:value={statusFilter}>
			<option value="">All statuses</option>
			<option value="draft">Draft</option>
			<option value="scheduled">Scheduled</option>
			<option value="sent">Sent</option>
		</Select>
	</div>

	{#if campaigns.length === 0}
		<EmptyState description="No campaigns yet." />
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Campaign</th>
				<th class="col-support cell-num">Recipients</th>
				<th class="col-support whitespace-nowrap">Date</th>
			{/snippet}
			{#each campaigns as c (c.id)}
				{@const href =
					c.status === 'draft'
						? resolve(`/staff/marketing/campaigns/${c.id}/edit`)
						: resolve(`/staff/marketing/campaigns/${c.id}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="w-px"><StatusBadge status={c.status} /></td>
					<!-- Audiences was its own column; it qualifies the campaign, so the
					     ref carries it as the subline. -->
					<td class="cell-primary"><EntityIdentity ref={c.ref} /></td>
					<td class="col-support cell-num">{c.recipientCount ?? '—'}</td>
					<td class="col-support whitespace-nowrap">
						{formatDateShort(c.sentAt ?? c.scheduledFor ?? c.createdAt)}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
