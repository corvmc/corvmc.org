<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { CancelSeriesAction } from '$lib/components/actions';
	import { getLocalUser } from '$lib/remote/users.remote';
	import { getRecurringReservations } from '$lib/remote/reservations.remote';
	import { formatScheduleLabel, formatTimeRange, formatDateShortYear } from '$lib/utils/format';
	// A strict distance between two instants has no timezone to get wrong, so
	// this one stays date-fns; the formatting around it does not.
	import { formatDistanceStrict } from 'date-fns';
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
					{formatTimeRange(series.startsAt, series.endsAt)} · {formatDistanceStrict(
						series.endsAt,
						series.startsAt,
						{ unit: 'minute' }
					)}
				</p>
				{#if series.seriesEndsAt}
					<p class="text-xs opacity-50">Ends {formatDateShortYear(series.seriesEndsAt)}</p>
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
		<!-- The control is a Frequency selector on step one of the Reserve Space
		     modal, two steps from the card that looks like it is about the same
		     thing. An empty list with nothing else in it read as a feature with
		     no way in, and a walk reached exactly that conclusion (#1001). -->
		<p class="text-muted">
			No active recurring reservations. Use <strong>Reserve Space</strong> at the top of this page and
			pick a frequency on the first step to start a series.
		</p>
	{/each}
{/if}
