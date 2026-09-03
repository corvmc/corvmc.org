<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
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

	const acts = $derived(await getStaffExternalActs({ search: searchDebounced || undefined }));
</script>

<PageHeader title="External acts" subtitle="Touring and off-platform acts CMC has booked">
	<CreateExternalActAction />
</PageHeader>

<PageContent>
	<Alert type="info" class="text-sm">
		These are records, not pages. An external act is never listed in the directory and has no page
		anywhere — wherever its name appears on a public bill it links out to the act's own site, or
		reads as plain text.
	</Alert>

	<InfoCard title="Acts">
		<SearchInput
			bind:value={searchText}
			placeholder="Search by name..."
			onsearch={(q) => (searchDebounced = q)}
		/>

		{#if acts.length === 0}
			<EmptyState
				description={searchDebounced ? 'No acts match that.' : 'No external acts recorded yet.'}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>Name</th>
					<th class="col-support">Hometown</th>
					<th class="col-extra">Their site</th>
					<th class="col-extra whitespace-nowrap">Added</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each acts as act (act.id)}
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
		{/if}
	</InfoCard>
</PageContent>
