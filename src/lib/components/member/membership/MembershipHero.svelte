<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant,
		actions
	}: {
		variant: 'marketing' | 'dashboard' | 'cancelled';
		actions?: Snippet;
	} = $props();

	const content = {
		marketing: {
			headline: 'Play More. Pay Less. Keep the Collective Going.',
			subtext:
				'Sustaining members chip in monthly and get free practice hours and gear perks. You set the amount — we keep the lights on and the amps warm.'
		},
		dashboard: {
			headline: 'You’re Part of What Makes This Work',
			subtext:
				'Your monthly contribution keeps the practice rooms open, the gear library stocked, and the community humming. Here’s where things stand.'
		},
		cancelled: {
			headline: 'Play More. Pay Less. Keep the Collective Going.',
			subtext:
				'Sustaining members chip in monthly and get free practice hours and gear perks. You set the amount — we keep the lights on and the amps warm.'
		}
	};

	const headline = $derived(content[variant].headline);
	const subtext = $derived(content[variant].subtext);
</script>

<div class="rounded-xl bg-primary/10 p-8 text-center">
	<h1 class="mb-4 text-4xl font-bold">{headline}</h1>
	<p class="mx-auto mb-6 max-w-2xl text-lg opacity-70">{subtext}</p>

	{#if actions}
		<div class="flex justify-center gap-4">
			{@render actions()}
		</div>
	{/if}
</div>
