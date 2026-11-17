<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDollars } from '#lib/utils/format.js';

	/**
	 * Rate, credits and total, as `Fact` rows for the caller's `DefinitionList`. Both
	 * reservation detail pages render this, so a band booking reads the same in either
	 * panel (#3131).
	 */
	let {
		hourlyRateCents,
		durationHours,
		totalCents,
		creditsUsed
	}: {
		hourlyRateCents: number;
		durationHours: number;
		totalCents: number;
		creditsUsed: number | null;
	} = $props();

	const durationLabel = $derived(m.reservations_charges_hours_label({ durationHours }));
</script>

<Fact label={m.reservations_charges_rate_label()}
	>{m.reservations_charges_hour_text({
		formatDollars: formatDollars(hourlyRateCents),
		durationLabel
	})}</Fact
>
{#if creditsUsed}
	<Fact label={m.reservations_charges_credits_applied_label()}>{creditsUsed}</Fact>
{/if}
<Fact label={m.reservations_charges_total_label()} class="font-medium"
	>${formatDollars(totalCents)}</Fact
>
