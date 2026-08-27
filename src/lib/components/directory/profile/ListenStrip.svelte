<script lang="ts">
	import ProfileSection from './ProfileSection.svelte';
	import { orderEmbeddableServices } from '$lib/utils/directory-display';
	import type { ProfileLink } from '$lib/server/db/schema/authentication';

	let { links }: { links: ProfileLink[] } = $props();

	const services = $derived(orderEmbeddableServices(links));

	let activeIndex = $state(0);
	const active = $derived(services[activeIndex] ?? services[0]);
</script>

{#if services.length > 0 && active}
	<ProfileSection title="Listen" note="one featured at a time">
		<div class="listen__tabs">
			{#each services as service, i (service.link.url)}
				<button
					type="button"
					class="listen__tab"
					class:is-active={i === activeIndex}
					onclick={() => (activeIndex = i)}
				>
					{service.name}
				</button>
			{/each}
		</div>
		<iframe
			src={active.embedUrl}
			title={active.link.label || active.name}
			width="100%"
			height={active.embedUrl.includes('youtube') ? '315' : '232'}
			frameborder="0"
			allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
			allowfullscreen
			loading="lazy"
			class="listen__frame"
		></iframe>
	</ProfileSection>
{/if}

<style>
	.listen__tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
	}
	.listen__tab {
		font-size: 12px;
		font-weight: 600;
		padding: 5px 11px;
		border-radius: var(--radius-pill, 9999px);
		border: 1px solid color-mix(in oklch, var(--cmc-brown) 28%, transparent);
		background: var(--bg-card);
		color: var(--fg-2);
		cursor: pointer;
		transition: all 120ms ease;
	}
	.listen__tab:hover {
		border-color: var(--color-primary);
		color: var(--fg-1);
	}
	.listen__tab.is-active {
		background: var(--color-secondary);
		color: var(--color-secondary-content);
		border-color: var(--color-secondary);
	}
	.listen__frame {
		display: block;
		border-radius: var(--radius, 8px);
	}
</style>
