<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import { CancelSeriesAction } from '$lib/components/shared/actions';
	import { getLocalUser } from '$lib/remote/users.remote';
	import { getRecurringReservations } from '$lib/remote/reservations.remote';
	import { formatScheduleLabel } from '$lib/utils/format';
	import { format, formatDistanceStrict } from 'date-fns';
</script>

{#if !(await getLocalUser()).subscription}
	<div class="rounded-lg border border-base-300 px-4 pb-3 text-sm">
		<h2 class="pt-4 text-lg font-semibold">Recurring Reservations</h2>

		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
			<span>Sustaining members can set up recurring weekly, biweekly, or monthly reservations.</span
			>
			<Button href="/member/membership" variant="default" size="sm" class="self-end sm:self-auto"
				>Learn More</Button
			>
		</div>
	</div>
{:else}
	<div class="flex items-center justify-between pt-4">
		<h2 class="text-lg font-semibold">My Recurring Reservations</h2>
	</div>

	{#each await getRecurringReservations() as series (series.id)}
		<div
			class="flex items-center justify-between rounded-md border-[2.5px] border-(--cmc-brown) bg-base-100 px-4 py-3"
		>
			<div class="min-w-0">
				<p class="font-medium">
					{formatScheduleLabel(series.frequencyLabel, series.startsAt, series.monthlyMode)}
				</p>
				<p class="text-muted">
					{format(series.startsAt, 'p')} – {format(series.endsAt, 'p')} · {formatDistanceStrict(
						series.endsAt,
						series.startsAt,
						{ unit: 'minute' }
					)}
				</p>
				{#if series.seriesEndsAt}
					<p class="text-xs opacity-50">Ends {format(series.seriesEndsAt, 'PP')}</p>
				{/if}
			</div>
			<CancelSeriesAction
				seriesId={series.id}
				variant="ghost"
				size="sm"
				shape="square"
				onsuccess={() => getRecurringReservations().refresh()}
			/>
		</div>
	{:else}
		<p class="text-muted">No active recurring reservations.</p>
	{/each}
{/if}
