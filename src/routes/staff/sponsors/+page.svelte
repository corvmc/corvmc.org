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
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const includeArchived = $derived(page.url.searchParams.get('archived') === '1');
	const sponsors = $derived(await getSponsors({ includeArchived }));

	function setArchived(on: boolean) {
		const url = new URL(page.url);
		if (on) url.searchParams.set('archived', '1');
		else url.searchParams.delete('archived');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
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
	<div class="flex justify-end">
		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={includeArchived}
				onchange={(e) => setArchived(e.currentTarget.checked)}
			/>
			Show archived
		</label>
	</div>

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
				<tr
					class="hover cursor-pointer"
					class:opacity-60={s.deletedAt}
					use:rowLink={resolve(`/staff/sponsors/${s.id}`)}
				>
					<td class="w-px">
						{#if s.current}
							<Badge variant={sponsorshipStatusBadge[s.current.status]} size="sm">
								{sponsorshipStatusLabels[s.current.status]}
							</Badge>
						{/if}
					</td>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/sponsors/${s.id}`)}>{s.name}</a>
						{#if s.deletedAt}
							<Badge variant="ghost" size="sm" class="ml-2">Archived</Badge>
						{/if}
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
