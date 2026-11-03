<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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

<PageHeader title={m.staff_sponsors_sponsors()} subtitle={m.staff_money()}>
	<Action
		action={createSponsor}
		label={m.staff_sponsors_label()}
		modalTitle={m.staff_sponsors_label()}
		submitLabel={m.staff_sponsors_submit_label()}
		successToast={m.staff_sponsors_success_toast()}
		data-testid="new-sponsor"
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
			{m.staff_show_archived()}
		</label>
	</div>

	{#if sponsors.length === 0}
		<EmptyState
			title={m.staff_sponsors_no_sponsors_yet()}
			description={m.staff_sponsors_description()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
				<th>{m.staff_sponsor()}</th>
				<th>{m.staff_ends()}</th>
				<th class="col-support cell-num">{m.staff_amount()}</th>
				<th class="col-extra">{m.staff_tier()}</th>
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
							<Badge variant="ghost" size="sm" class="ml-2">{m.staff_archived()}</Badge>
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
