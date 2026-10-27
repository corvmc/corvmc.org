<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { previewRecurringEvents, startEventSeries } from '$lib/remote/events.remote';
	import { toLocalDate, toLocalTime } from '$lib/utils/format';

	// Makes an existing listing the first of a series. Not on the create modal,
	// which collects only what the row needs.
	let { eventId, startsAt, onsuccess }: { eventId: string; startsAt: Date; onsuccess: () => void } =
		$props();

	const fields = startEventSeries.fields;

	let frequency = $state('weekly');
	let monthlyMode = $state('weekday');
	let endsAt = $state('');

	const isMonthly = $derived(frequency === 'monthly');

	// Read inside the modal's snippet, so nothing is fetched until it opens.
	const previewArgs = $derived({
		date: toLocalDate(startsAt),
		startTime: toLocalTime(startsAt),
		frequency: frequency as 'weekly' | 'biweekly' | 'monthly',
		monthlyMode: isMonthly ? (monthlyMode as 'weekday' | 'monthday') : undefined
	});

	function formatOccurrence(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<Action
	action={startEventSeries}
	label="Repeat this event"
	variant="ghost"
	size="sm"
	modalTitle="Repeat this event"
	submitLabel="Repeat"
	successToast="Series started"
	{onsuccess}
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<div class="space-y-4">
			<FormField
				field={fields.recurringFrequency}
				type="select"
				label="Frequency"
				bind:value={frequency}
				options={[
					{ value: 'weekly', label: 'Weekly' },
					{ value: 'biweekly', label: 'Every 2 weeks' },
					{ value: 'monthly', label: 'Monthly' }
				]}
			/>
			{#if isMonthly}
				<FormField
					field={fields.monthlyMode}
					type="select"
					label="Monthly pattern"
					bind:value={monthlyMode}
					options={[
						{ value: 'weekday', label: 'Same weekday each month (e.g. 2nd Tuesday)' },
						{ value: 'monthday', label: 'Same date each month (e.g. the 15th)' }
					]}
				/>
			{/if}
			<FormField
				field={fields.recurringEndsAt}
				type="date"
				label="Repeat until (optional)"
				bind:value={endsAt}
			/>
			<p class="text-muted">
				Occurrences are created as drafts ahead of time; publish each one when ready. Each starts
				with a copy of this event's poster.
			</p>
			{#await previewRecurringEvents(previewArgs) then preview}
				{#if preview.dates.length > 0}
					<div class="text-sm">
						<p class="font-medium">Next occurrences:</p>
						<ul class="mt-1 opacity-70">
							{#each preview.dates as iso (iso)}
								<li>{formatOccurrence(iso)}</li>
							{/each}
						</ul>
					</div>
				{:else}
					<p class="text-muted">No upcoming occurrences in the next 60 days.</p>
				{/if}
			{/await}
		</div>
	{/snippet}
</Action>
