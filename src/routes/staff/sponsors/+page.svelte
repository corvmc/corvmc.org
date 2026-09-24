<script lang="ts">
	/** Businesses that sponsor the collective, the one whose term ends soonest first. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import SponsorFields from '$lib/components/sponsor/SponsorFields.svelte';
	import { getSponsors, createSponsor } from '$lib/remote/sponsors.remote';
	import { sponsorshipStatusLabels, sponsorshipStatusBadge } from '$lib/config';
	import { formatCents } from '$lib/utils/format';
	import { formatIsoDay } from '$lib/utils/deadline';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';

	const sponsors = $derived(await getSponsors());
</script>

<PageHeader title="Sponsors" subtitle="Money">
	<Action
		action={createSponsor}
		label="New sponsor"
		modalTitle="New sponsor"
		submitLabel="Add sponsor"
		successToast="Sponsor added"
	>
		{#snippet form()}
			<SponsorFields fields={createSponsor.fields} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if sponsors.length === 0}
		<EmptyState
			title="No sponsors yet"
			description="Add a business that sponsors the collective, or one you are about to ask."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Sponsor</th>
				<th>Ends</th>
				<th class="col-support cell-num">Amount</th>
				<th class="col-extra">Tier</th>
			{/snippet}
			{#each sponsors as s (s.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/sponsors/${s.id}`)}>
					<td class="w-px">
						{#if s.current}
							<Badge variant={sponsorshipStatusBadge[s.current.status]} size="sm">
								{sponsorshipStatusLabels[s.current.status]}
							</Badge>
						{/if}
					</td>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/sponsors/${s.id}`)}>{s.name}</a>
						<div class="truncate text-muted">
							{s.current?.title ?? (s.sponsorships ? 'No current sponsorship' : 'Never sponsored')}
						</div>
					</td>
					<td class="whitespace-nowrap">
						{#if s.deadline}
							<span class:text-error={s.deadline.overdue}>{formatIsoDay(s.deadline.on)}</span>
						{:else}
							—
						{/if}
					</td>
					<td class="col-support cell-num">
						{s.current?.amountCents != null ? formatCents(s.current.amountCents) : '—'}
					</td>
					<td class="col-extra">{s.current?.tier ?? '—'}</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={sponsors.length} unit="sponsors" />
	{/if}
</PageContent>
