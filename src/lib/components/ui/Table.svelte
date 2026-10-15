<script lang="ts">
	/**
	 * Table chrome only — the scroll wrapper, the daisyUI modifiers, and the
	 * `thead`/`tbody` boilerplate. It owns no columns: pages write their own
	 * `<th>`/`<td>`, because every staff table has bespoke cells (StatusBadge
	 * glyphs, EntityIdentity, action clusters, group-header rows).
	 *
	 * Column visibility is handled with the `col-support` / `col-extra` utilities
	 * in layout.css, applied to a column's `<th>` and its `<td>`s alike. At wide
	 * widths `table-packed` sends the spare width past the last column (#1925).
	 */
	import type { Snippet } from 'svelte';

	// A static map, not `table-${size}` — Tailwind v4's source scanner cannot see
	// class names built by template literal, so the generated CSS would be absent.
	const sizeClass = { xs: 'table-xs', sm: 'table-sm', md: '' } as const;

	let {
		head,
		children,
		size = 'sm',
		zebra = true,
		packed = true,
		class: className = ''
	}: {
		/** The `<th>` cells; wrapped in `<thead><tr>` here. */
		head?: Snippet;
		/** The `<tr>` rows; wrapped in `<tbody>` here. */
		children: Snippet;
		size?: keyof typeof sizeClass;
		zebra?: boolean;
		/** Off for a table that shares its row with a sidebar: the primary cell
		 *  absorbs the slack and truncates, so the table never outgrows its column. */
		packed?: boolean;
		class?: string;
	} = $props();
</script>

<div class="overflow-x-auto">
	<table
		class="table {packed ? 'table-packed' : ''} {sizeClass[size]} {zebra
			? 'table-zebra'
			: ''} {className}"
	>
		{#if head}
			<thead>
				<tr>{@render head()}</tr>
			</thead>
		{/if}
		<tbody>
			{@render children()}
		</tbody>
	</table>
</div>
