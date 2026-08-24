<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import { formatTimeRange, formatDate } from '$lib/utils/format';
	import Badge from '$lib/components/shared/Badge.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { getSeries, getSeriesHistory, cancelDetailSeries } from '$lib/remote/recurring.remote';
	const { fields: cancelFields } = cancelDetailSeries;

	let id = $derived(page.params.id!);
	let series = $derived(await getSeries(id));
	let history = $derived(await getSeriesHistory(id));

	let isActive = $derived(!series.cancelledAt);
</script>

<PageHeader title="Recurring Series" backHref="/staff/recurring">
	{#if isActive}
		<Action
			action={cancelDetailSeries}
			label="Cancel Series"
			modalTitle="Confirm"
			successToast="Series cancelled"
			variant="error"
			size="sm"
			outline
			onsuccess={() => invalidateAll()}
		>
			{#snippet form()}
				<input {...cancelFields.seriesId.as('hidden', id)} />
				<p class="py-4">Cancel this recurring series? No new reservations will be generated.</p>
			{/snippet}
		</Action>
	{/if}
</PageHeader>
<PageContent width="3xl">
	<div class="flex items-center gap-2 mb-4">
		{#if series.cancelledAt}
			<StatusBadge status="cancelled" />
		{:else}
			<StatusBadge status="active" />
		{/if}
	</div>

	<!-- Current schedule -->
	<InfoCard title="Schedule">
		<DefinitionList>
			<Fact label="RRULE" mono>{series.rrule}</Fact>

			<Fact label="Prototype Time"
				>{formatTimeRange(series.prototypeStartsAt, series.prototypeEndsAt)}</Fact
			>

			<Fact label="Booker">{series.prototypeBookerType}: {series.prototypeBookerId}</Fact>

			{#if series.prototypeNotes}
				<Fact label="Notes">{series.prototypeNotes}</Fact>
			{/if}

			<Fact label="Created">{formatDate(series.createdAt)}</Fact>

			{#if series.cancelledAt}
				<Fact label="Cancelled">{formatDate(series.cancelledAt)}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<!-- History -->
	{#if history.length > 1}
		<InfoCard title="Supersession History">
			<div class="space-y-2">
				{#each history as h, i (h.id)}
					<div class="flex items-center gap-3 text-sm" class:opacity-50={i > 0}>
						<span class="font-mono text-xs">{h.id.slice(0, 8)}</span>
						<span class="font-mono text-xs flex-1">{h.rrule}</span>
						<span>{formatDate(h.createdAt)}</span>
						{#if h.cancelledAt}
							<StatusBadge status="cancelled" />
						{:else if h.supersededBy}
							<Badge variant="ghost">superseded</Badge>
						{:else}
							<StatusBadge status="active" />
						{/if}
					</div>
				{/each}
			</div>
		</InfoCard>
	{/if}
</PageContent>
