<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconCircle, IconCircleCheckFilled } from '@tabler/icons-svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { dismissInviteStep } from '#lib/remote/band-dashboard.remote.js';
	import type { BandSetupKey, BandSetupStep } from '#lib/types/band-dashboard.js';

	// A new band's first four steps (#3134), each ticked once done. The query sends
	// none once all four are, and the press kit takes this card's place.
	let { slug, steps }: { slug: string; steps: BandSetupStep[] } = $props();

	const labels: Record<BandSetupKey, () => string> = {
		invite: m.band_slug_next_steps_invite_member_text,
		reserve: m.band_slug_next_steps_reserve_text,
		profile: m.band_slug_setup_profile_text,
		event: m.band_slug_setup_event_text
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
					<span class="sr-only">{m.band_slug_setup_done_text()}</span>
				{:else}
					<IconCircle size={20} class="text-base-content/40" aria-hidden="true" />
					<a href={step.href} class="link link-primary">{labels[step.key]()}</a>
					{#if step.dismissible}
						<!-- A one-person project has no one to invite (#3127). -->
						<Form remote={dismissInviteStep} class="ms-auto">
							<input {...dismissInviteStep.fields.slug.as('hidden', slug)} />
							<SubmitButton label={m.band_slug_setup_dismiss_label()} variant="ghost" size="xs" />
						</Form>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
</InfoCard>
