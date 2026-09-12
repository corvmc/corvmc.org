<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { formatTimeRange, formatDate, formatScheduleLabel } from '$lib/utils/format';
	import { EntityChip } from '$lib/components/ui/entity';
	import Badge from '$lib/components/ui/Badge.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { getStaffSeriesDetail, cancelDetailSeries } from '$lib/remote/recurring.remote';
	const { fields: cancelFields } = cancelDetailSeries;

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffSeriesDetail(id));
	const series = $derived(data.series);
	const history = $derived(data.history);

	let isActive = $derived(!series.cancelledAt);
</script>

<!-- The schedule, not the word "Recurring Series": the title was a constant, so
     every series had the same heading and the same browser-tab title (#1065). -->
<PageHeader
	title={formatScheduleLabel(series.frequencyLabel, series.prototypeStartsAt, series.monthlyMode)}
	subtitle="Recurring series"
	backHref="/staff/recurring"
>
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
	<div class="mb-4 flex items-center gap-2">
		{#if series.cancelledAt}
			<StatusBadge status="cancelled" />
		{:else}
			<StatusBadge status="active" />
		{/if}
	</div>

	<!-- Current schedule -->
	<InfoCard title="Schedule">
		<DefinitionList>
			<!-- The plain-English schedule the list row shows. The raw RRULE stays,
			     because staff do read it when a series misbehaves — but it is no
			     longer the only thing on offer (#1065). -->
			<Fact label="Schedule">
				{formatScheduleLabel(series.frequencyLabel, series.prototypeStartsAt, series.monthlyMode)}
			</Fact>

			<Fact label="RRULE" mono>{series.rrule}</Fact>

			<Fact label="Prototype Time"
				>{formatTimeRange(series.prototypeStartsAt, series.prototypeEndsAt)}</Fact
			>

			<Fact label="Booker"><EntityChip ref={series.booker} /></Fact>

			<!-- The booking the series was cut from. Its times were on this page and
			     its id was on the record, and there was no way to open it. -->
			<Fact label="Prototype"><EntityChip ref={series.prototype} /></Fact>

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
						<span class="flex-1 font-mono text-xs">{h.rrule}</span>
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
