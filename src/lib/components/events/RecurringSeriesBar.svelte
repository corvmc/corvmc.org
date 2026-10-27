<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { cancelEventSeries } from '$lib/remote/events.remote';
	import { fullDate } from '$lib/utils/format';

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
	<Badge class="badge-info">Recurring · {series.frequencyLabel}</Badge>
	{#if series.cancelledAt}
		<span class="text-muted">Series cancelled — no new occurrences</span>
	{:else}
		<span class="text-muted">
			{#if series.endsAt}
				Repeats until {fullDate(series.endsAt)}
			{:else}
				New occurrences are generated automatically
			{/if}
		</span>
		<Form remote={cancelEventSeries} successToast="Series cancelled" onsuccess={onchange}>
			<input {...cancelEventSeries.fields.eventId.as('hidden', eventId)} />
			<SubmitButton label="Cancel series" variant="ghost" size="xs" class="text-error" />
		</Form>
	{/if}
</div>
