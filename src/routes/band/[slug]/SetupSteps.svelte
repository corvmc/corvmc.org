<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconCircle, IconCircleCheckFilled } from '@tabler/icons-svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import type { BandSetupKey, BandSetupStep } from '#lib/types/band-dashboard.js';

	// A new band's first four steps (#3134), each ticked once done. The query sends
	// none once all four are, and the press kit takes this card's place.
	let { steps }: { steps: BandSetupStep[] } = $props();

	const labels: Record<BandSetupKey, () => string> = {
		invite: m.band_slug_next_steps_invite_member_label,
		reserve: m.band_slug_next_steps_reserve_label,
		profile: m.band_slug_setup_profile_label,
		event: m.band_slug_setup_event_label
	};

	const done = $derived(steps.filter((s) => s.done).length);
</script>

<InfoCard title={m.band_slug_setup_title()} state="{done}/{steps.length}">
	<ul class="flex flex-col gap-2">
		{#each steps as step (step.key)}
			<li class="flex items-center gap-2" data-done={step.done || undefined}>
				{#if step.done}
					<IconCircleCheckFilled size={20} class="text-success" aria-hidden="true" />
					<span class="text-subtle line-through">{labels[step.key]()}</span>
					<span class="sr-only">{m.band_slug_setup_done_label()}</span>
				{:else}
					<IconCircle size={20} class="text-base-content/40" aria-hidden="true" />
					<a href={step.href} class="link link-primary">{labels[step.key]()}</a>
				{/if}
			</li>
		{/each}
	</ul>
</InfoCard>
