<script lang="ts">
	import Badge from './Badge.svelte';
	import type { ComponentProps } from 'svelte';

	/**
	 * A row of short labels as badges, clamped so one crowded record cannot set
	 * the height of every row beside it.
	 *
	 * Table cells kept growing their own copy of `flex flex-wrap gap-1` + `{#each}`
	 * over a `badge badge-ghost` span — the volunteer roles table, the interested-
	 * members list, the volunteers index. Each wrapped, so a member with eight
	 * interests made a four-line row and dragged the whole table's rhythm with it.
	 *
	 * `max` is the fix: the first few labels render, the rest collapse into a `+N`
	 * whose tooltip names them. Left unset nothing is hidden, which is the right
	 * call on a detail page where there is room and no rhythm to protect.
	 *
	 * Domain-free by design — it takes strings, not roles or certifications. A
	 * caller that needs each label to be a link wants its own `{#each}`; wiring
	 * hrefs through here would drag route knowledge into `ui/`.
	 */
	let {
		items,
		max,
		variant = 'ghost',
		size = 'sm',
		wrap = false,
		class: className = ''
	}: {
		items: string[];
		/** Show at most this many; the rest become a `+N` badge. Omit to show all. */
		max?: number;
		variant?: ComponentProps<typeof Badge>['variant'];
		size?: ComponentProps<typeof Badge>['size'];
		/**
		 * Let the row run onto more lines. Off by default: the reason this exists
		 * is that wrapping is what made the rows uneven.
		 */
		wrap?: boolean;
		class?: string;
	} = $props();

	const shown = $derived(max === undefined ? items : items.slice(0, max));
	const hidden = $derived(max === undefined ? [] : items.slice(max));
</script>

{#if items.length > 0}
	<div class="flex items-center gap-1 {wrap ? 'flex-wrap' : 'whitespace-nowrap'} {className}">
		{#each shown as label (label)}
			<Badge {variant} {size}>{label}</Badge>
		{/each}

		{#if hidden.length > 0}
			<!-- Titled rather than truncated: the count says how many more, and the
			     tooltip says which, without a click to somewhere else. -->
			<!-- `inline-flex`, not a bare span: an inline wrapper sits on the text
			     baseline and drops the badge a few pixels below its neighbours. -->
			<span class="inline-flex" title={hidden.join(', ')}>
				<Badge {variant} {size}>+{hidden.length}</Badge>
			</span>
		{/if}
	</div>
{/if}
