<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { getStaffExternalActs } from '$lib/remote/external-acts.remote';
	import CreateExternalActAction from './CreateExternalActAction.svelte';
	import ClaimExternalActAction from './ClaimExternalActAction.svelte';
	import { formatDateShort } from '$lib/utils/format';

	/**
	 * External acts — parties CMC has booked that are not members of anything
	 * here.
	 *
	 * Its own route rather than a section of `/staff/bands`, because that page
	 * already holds a load-bearing query and a second one fanned out beside it is
	 * what `custom/no-concurrent-remote-queries` exists to stop.
	 *
	 * Staff-only, and there is no member-facing counterpart anywhere: an external
	 * act has no page, no slug and no public surface. This list is the whole of
	 * how anyone sees one.
	 */
	let searchText = $state('');
	let searchDebounced = $state('');
	let pageNo = $state(1);

	const acts = $derived(
		await getStaffExternalActs({ search: searchDebounced || undefined, page: pageNo })
	);

	function search(q: string) {
		searchDebounced = q;
		pageNo = 1;
	}
</script>

<PageHeader title={m.staff_external_acts()} subtitle={m.staff_bands_acts_subtitle()}>
	<CreateExternalActAction />
</PageHeader>

<PageContent>
	<Alert type="info" class="text-sm">
		{m.staff_bands_acts_these_records_not_pages_external()}
	</Alert>

	<InfoCard title={m.staff_bands_acts_acts()}>
		<SearchInput bind:value={searchText} placeholder={m.staff_search_by_name()} onsearch={search} />

		{#if acts.rows.length === 0}
			<EmptyState
				description={searchDebounced
					? m.staff_bands_acts_no_acts_match()
					: m.staff_bands_acts_no_external_acts_recorded_yet()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_name()}</th>
					<th class="col-support">{m.staff_hometown()}</th>
					<th class="col-extra">{m.staff_their_site()}</th>
					<th class="col-extra whitespace-nowrap">{m.staff_added()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
				{/snippet}
				{#each acts.rows as act (act.id)}
					<tr>
						<td class="cell-primary">{act.name}</td>
						<td class="col-support">{act.hometown ?? '—'}</td>
						<td class="col-extra">
							{#if act.links?.[0]?.url}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- the act's own URL, not an internal route -->
								<a
									href={act.links[0].url}
									class="link"
									target="_blank"
									rel="noopener noreferrer nofollow">{act.links[0].label || 'Website'}</a
								>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{:else}
								—
							{/if}
						</td>
						<td class="col-extra whitespace-nowrap">{formatDateShort(act.createdAt)}</td>
						<td class="w-px"><ClaimExternalActAction entryId={act.id} actName={act.name} /></td>
					</tr>
				{/each}
			</Table>
			<Pagination {...acts.pagination} onpage={(n) => (pageNo = n)} />
		{/if}
	</InfoCard>
</PageContent>
