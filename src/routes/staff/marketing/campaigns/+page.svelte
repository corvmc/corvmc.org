<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getCampaigns } from '$lib/remote/marketing.remote';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';

	let statusFilter = $state('');
	let campaigns = $derived(await getCampaigns({ status: statusFilter || undefined }));
</script>

<PageHeader title={m.staff_marketing_campaigns_title()} subtitle={m.staff_marketing()}>
	<Button href="/staff/marketing/campaigns/new" variant="default" size="sm"
		>{m.staff_new_campaign()}</Button
	>
</PageHeader>
<PageContent>
	<div class="mb-4 flex gap-2">
		<Select size="sm" aria-label={m.staff_status()} bind:value={statusFilter}>
			<option value="">{m.staff_all_statuses()}</option>
			<option value="draft">{m.staff_draft()}</option>
			<option value="scheduled">{m.staff_marketing_campaigns_scheduled()}</option>
			<option value="sent">{m.staff_sent()}</option>
		</Select>
	</div>

	{#if campaigns.length === 0}
		<EmptyState description={m.staff_marketing_campaigns_description()} />
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
				<th>{m.staff_campaign()}</th>
				<th class="col-support cell-num">{m.staff_recipients()}</th>
				<th class="col-support whitespace-nowrap">{m.staff_date()}</th>
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
		<Pagination total={campaigns.length} unit="campaigns" />
	{/if}
</PageContent>
