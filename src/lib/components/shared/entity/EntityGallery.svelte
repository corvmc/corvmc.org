<script lang="ts">
	import type { Snippet } from 'svelte';
	import { entityTypes, entityLabels, type EntityType } from '$lib/config';

	/**
	 * Stories-only: renders one snippet per entity type, labelled.
	 *
	 * Exists so each tier gets a single story showing *every* type at once. That
	 * is the visual net for an icon collision or a wrong glyph — `registry.spec`
	 * proves the icons are distinct, but only looking at them proves they are
	 * each the right one. Same role as `CardHarness` / `DefinitionListHarness`.
	 */
	let { item, columns = 2 }: { item: Snippet<[EntityType]>; columns?: 1 | 2 } = $props();
</script>

<div class="grid gap-x-8 gap-y-3" class:grid-cols-2={columns === 2}>
	{#each entityTypes as type (type)}
		<!-- min-w-0 on the grid item: grid children default to min-width:auto, which
		     refuses to shrink, so the content overflows into the next column and the
		     chip's own truncate never engages. -->
		<div class="flex min-w-0 items-baseline gap-3">
			<span class="w-28 shrink-0 text-subtle">{entityLabels[type].one}</span>
			<div class="min-w-0 flex-1">{@render item(type)}</div>
		</div>
	{/each}
</div>
