<script lang="ts">
	/**
	 * Overlapping avatars on one line, with "+N" for whoever is not drawn.
	 * `total` is the whole count when the caller sent only the first few.
	 */
	import EntityAvatar from './entity/EntityAvatar.svelte';

	let {
		items,
		total = items.length,
		max = 4,
		shape = 'square',
		label
	}: {
		items: { name: string; image?: string | null }[];
		total?: number;
		max?: number;
		shape?: 'round' | 'square';
		/** Accessible name for the group; defaults to the names drawn. */
		label?: string;
	} = $props();

	const shown = $derived(items.slice(0, max));
	const rest = $derived(Math.max(0, total - shown.length));
	const names = $derived(
		label ??
			items.map((i) => i.name).join(', ') +
				(total > items.length ? ` and ${total - items.length} more` : '')
	);
</script>

<span class="inline-flex items-center" role="img" aria-label={names} title={names}>
	{#each shown as item, i (i)}
		<EntityAvatar
			name={item.name}
			image={item.image}
			{shape}
			size="avatar-sm"
			class="size-7 ring-2 ring-base-100 {i > 0 ? '-ml-1' : ''}"
		/>
	{/each}
	{#if rest > 0}
		<span class="ml-1 text-muted text-xs">+{rest}</span>
	{/if}
</span>
