<script lang="ts">
	/** CMC's own permits, licenses and insurance policies, the soonest to expire first. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import RenewalFields from '$lib/components/renewal/RenewalFields.svelte';
	import { getRenewals, createRenewal } from '$lib/remote/renewals.remote';
	import { renewalKindLabels } from '$lib/config';
	import { formatIsoDay } from '$lib/utils/deadline';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';

	const { renewals, assignees } = $derived(await getRenewals());
</script>

<PageHeader title="Renewals" subtitle="System">
	<Action
		action={createRenewal}
		label="New renewal"
		modalTitle="New renewal"
		submitLabel="Add renewal"
		successToast="Renewal added"
	>
		{#snippet form()}
			<RenewalFields fields={createRenewal.fields} {assignees} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if renewals.length === 0}
		<EmptyState
			title="No renewals yet"
			description="Add a permit, license or insurance policy the collective holds, with the day it expires."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Renewal</th>
				<th>Expires</th>
				<th class="col-support">Kind</th>
				<th class="col-extra">Responsible</th>
			{/snippet}
			{#each renewals as r (r.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/renewals/${r.id}`)}>
					<td class="w-px">
						{#if r.deadline.overdue}
							<Badge variant="error" size="sm">Lapsed</Badge>
						{:else if r.daysLeft <= 60}
							<Badge variant="warning" size="sm">Due soon</Badge>
						{/if}
					</td>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/renewals/${r.id}`)}>{r.name}</a>
						<div class="truncate text-muted">{r.issuer ?? '—'}</div>
					</td>
					<td class="whitespace-nowrap">
						<span class:text-error={r.deadline.overdue}>{formatIsoDay(r.expiresOn)}</span>
					</td>
					<td class="col-support">{renewalKindLabels[r.kind]}</td>
					<td class="col-extra">{r.responsibleName ?? '—'}</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={renewals.length} unit="renewals" />
	{/if}
</PageContent>
