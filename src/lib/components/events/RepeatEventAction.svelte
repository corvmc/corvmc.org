<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { previewRecurringEvents, startEventSeries } from '#lib/remote/events.remote.js';
	import { toLocalDate, toLocalTime, formatDate } from '#lib/utils/format.js';

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
		return formatDate(new Date(iso));
	}
</script>

<Action
	action={startEventSeries}
	label={m.events_repeat_event_repeat_event()}
	variant="ghost"
	size="sm"
	modalTitle={m.events_repeat_event_repeat_event()}
	submitLabel={m.events_repeat_event_submit_label()}
	successToast={m.events_repeat_event_success_toast()}
	{onsuccess}
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<div class="space-y-4">
			<FormField
				field={fields.recurringFrequency}
				type="select"
				label={m.events_repeat_event_frequency()}
				bind:value={frequency}
				options={[
					{ value: 'weekly', label: m.events_repeat_event_weekly() },
					{ value: 'biweekly', label: m.events_repeat_event_every_2_weeks() },
					{ value: 'monthly', label: m.events_repeat_event_monthly() }
				]}
			/>
			{#if isMonthly}
				<FormField
					field={fields.monthlyMode}
					type="select"
					label={m.events_repeat_event_monthly_pattern()}
					bind:value={monthlyMode}
					options={[
						{ value: 'weekday', label: m.events_repeat_event_same_weekday_each_month_e() },
						{ value: 'monthday', label: m.events_repeat_event_same_date_each_month_e() }
					]}
				/>
			{/if}
			<FormField
				field={fields.recurringEndsAt}
				type="date"
				label={m.events_repeat_event_repeat_until_optional()}
				bind:value={endsAt}
			/>
			<p class="text-muted">
				{m.events_repeat_event_occurrences_created_as_drafts_ahead()}
			</p>
			{#await previewRecurringEvents(previewArgs) then preview}
				{#if preview.dates.length > 0}
					<div class="text-sm">
						<p class="font-medium">{m.events_repeat_event_next_occurrences()}</p>
						<ul class="mt-1 opacity-70">
							{#each preview.dates as iso (iso)}
								<li>{formatOccurrence(iso)}</li>
							{/each}
						</ul>
					</div>
				{:else}
					<p class="text-muted">{m.events_repeat_event_no_upcoming_occurrences_next_60()}</p>
				{/if}
			{:catch}
				<!-- A courtesy preview: the form still submits without it. -->
			{/await}
		</div>
	{/snippet}
</Action>
