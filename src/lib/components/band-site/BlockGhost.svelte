<script lang="ts">
	import {
		IconArrowUpRight,
		IconPhoto,
		IconPlayerPlay,
		IconLayoutBoard
	} from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import { BLOCK_SOURCES } from './block-editing';
	import type { Block } from '$lib/types/band-page';

	/**
	 * What a block looks like before it has anything in it.
	 *
	 * The renderer gates eleven of the fourteen block types on having data — no
	 * gigs means no Shows section at all — so without this a new band arranges a
	 * page out of blocks it cannot see. The ghost draws the block's *real*
	 * geometry, which is what makes it useful for judging order and rhythm, in
	 * the theme's own muted ink thinned to 26% so it sits in the band's palette
	 * on a white page and a near-black one alike and is never mistakable for
	 * content.
	 *
	 * Editor-only. The public page renders nothing here, exactly as it does now,
	 * so Preview and the live site still agree about what actually publishes.
	 */
	let { type, slug }: { type: Block['type']; slug: string } = $props();

	const source = $derived(BLOCK_SOURCES[type]);
	const ownerHref = $derived(source.owner ? resolve(`/band/${slug}/${source.owner}`) : null);
</script>

<div class="mx-auto max-w-3xl px-6 py-8">
	{#if type === 'bio'}
		<div class="flex flex-col gap-2">
			<div class="g-bar" style="width: 100%"></div>
			<div class="g-bar" style="width: 97%"></div>
			<div class="g-bar" style="width: 58%"></div>
		</div>
	{:else if type === 'links'}
		<div class="mx-auto flex max-w-md flex-col gap-3">
			{#each [0, 1, 2] as i (i)}
				<div class="g-outline h-11 rounded-lg"></div>
			{/each}
		</div>
	{:else if type === 'members'}
		<h2 class="mb-4 text-2xl font-bold">Members</h2>
		<div class="grid grid-cols-2 gap-4 md:grid-cols-3">
			{#each [0, 1, 2] as i (i)}
				<div class="text-center">
					<div class="g-bar mx-auto mb-2 h-16 w-16 rounded-full"></div>
					<div class="g-bar mx-auto" style="width: 72%"></div>
				</div>
			{/each}
		</div>
	{:else if type === 'events'}
		<h2 class="mb-4 text-2xl font-bold">Upcoming Shows</h2>
		<div class="flex flex-col gap-3">
			{#each [0, 1] as i (i)}
				<div class="g-surface h-[62px] rounded-lg"></div>
			{/each}
		</div>
	{:else if type === 'gallery'}
		<div class="grid grid-cols-2 gap-2 md:grid-cols-3">
			{#each [0, 1, 2] as i (i)}
				<div class="g-bar flex aspect-square items-center justify-center rounded-lg">
					<IconPhoto size={22} opacity={0.5} />
				</div>
			{/each}
		</div>
	{:else if type === 'embed'}
		<div class="g-bar flex h-[100px] items-center justify-center rounded-lg">
			<IconPlayerPlay size={24} opacity={0.5} />
		</div>
	{:else if type === 'press'}
		<h2 class="mb-4 text-2xl font-bold">Press</h2>
		<blockquote class="g-rule pl-4">
			<div class="flex flex-col gap-2">
				<div class="g-bar" style="width: 100%"></div>
				<div class="g-bar" style="width: 72%"></div>
			</div>
			<div class="g-bar mt-3 h-2" style="width: 38%"></div>
		</blockquote>
	{:else if type === 'achievements'}
		<h2 class="mb-4 text-2xl font-bold">Highlights</h2>
		<div class="flex flex-col gap-3">
			{#each [100, 72, 84] as w (w)}
				<div class="g-bar" style="width: {w}%"></div>
			{/each}
		</div>
	{:else if type === 'tech_rider'}
		<h2 class="mb-4 text-2xl font-bold">Technical Requirements</h2>
		<div class="g-bar flex h-[110px] items-center justify-center rounded-lg">
			<IconLayoutBoard size={22} opacity={0.5} />
		</div>
	{:else if type === 'merch'}
		<h2 class="mb-4 text-2xl font-bold">Merch</h2>
		<div class="grid grid-cols-2 gap-4 md:grid-cols-3">
			{#each [0, 1, 2] as i (i)}
				<div>
					<div class="g-bar aspect-square rounded-lg"></div>
					<div class="g-bar mt-2" style="width: 78%"></div>
				</div>
			{/each}
		</div>
	{:else if type === 'custom_html'}
		<div
			class="g-dashed flex h-[90px] items-center justify-center rounded-lg text-xs tracking-wide"
		>
			YOUR OWN HTML
		</div>
	{/if}

	{#if source.action}
		<p class="mt-4 mb-0 text-sm">
			{#if ownerHref}
				<a href={ownerHref} class="inline-flex items-center gap-1.5">
					{source.action}
					<IconArrowUpRight size={13} />
				</a>
			{:else}
				<span class="opacity-60">{source.action}</span>
			{/if}
		</p>
	{/if}
</div>

<style>
	/* Flat fills, no shimmer: a pulsing skeleton reads as *loading*, and this is
	   *empty* — a different message that needs a different treatment. The ink is
	   the band theme's own muted colour, so the ghost belongs to their page. */
	.g-bar {
		height: 10px;
		border-radius: 4px;
		background: color-mix(in oklch, var(--bs-muted, #6b7280) 26%, transparent);
	}
	.g-surface {
		background: var(--bs-surface, #f5f5f5);
	}
	.g-outline {
		border: 1px solid color-mix(in oklch, var(--bs-muted, #6b7280) 32%, transparent);
	}
	.g-dashed {
		border: 1px dashed color-mix(in oklch, var(--bs-muted, #6b7280) 42%, transparent);
		color: var(--bs-muted, #6b7280);
	}
	.g-rule {
		border-left: 4px solid color-mix(in oklch, var(--bs-accent, #3b82f6) 45%, transparent);
	}
</style>
