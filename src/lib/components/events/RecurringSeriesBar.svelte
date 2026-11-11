<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { cancelEventSeries } from '#lib/remote/events.remote.js';
	import { fullDate } from '#lib/utils/format.js';

	/**
	 * The series a listing belongs to, and the one control on it: stop making
	 * new occurrences. Keyed on the occurrence, not the series, so the guard
	 * reads the show's committee off the same row (#1948).
	 */
	interface Props {
		eventId: string;
		series: { frequencyLabel: string; endsAt: Date | null; cancelledAt: Date | null };
		onchange: () => void;
	}

	let { eventId, series, onchange }: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-2">
	<Badge class="badge-info"
		>{m.events_recurring_series_bar_recurring_label({
			frequencyLabel: series.frequencyLabel
		})}</Badge
	>
	{#if series.cancelledAt}
		<span class="text-muted"
			>{m.events_recurring_series_bar_series_cancelled_no_new_occurren_text()}</span
		>
	{:else}
		<span class="text-muted">
			{#if series.endsAt}{m.events_recurring_series_bar_repeats_until_text({
					fullDate: fullDate(series.endsAt)
				})}
			{:else}{m.events_recurring_series_bar_new_occurrences_generated_automa_text()}{/if}
		</span>
		<Form
			remote={cancelEventSeries}
			successToast={m.events_recurring_series_bar_success_toast()}
			onsuccess={onchange}
		>
			<input {...cancelEventSeries.fields.eventId.as('hidden', eventId)} />
			<SubmitButton
				label={m.events_recurring_series_bar_label()}
				variant="ghost"
				size="xs"
				class="text-error"
			/>
		</Form>
	{/if}
</div>
