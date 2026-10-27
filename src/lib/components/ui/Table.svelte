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

	let scroller: HTMLDivElement;
	let overflowStart = $state(false);
	let overflowEnd = $state(false);

	function measure() {
		const { scrollLeft, scrollWidth, clientWidth } = scroller;
		overflowStart = scrollLeft > 1;
		overflowEnd = scrollLeft + clientWidth < scrollWidth - 1;
	}

	$effect(() => {
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(scroller);
		if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
		return () => observer.disconnect();
	});
</script>

<div
	class="table-frame"
	data-overflow-start={overflowStart || undefined}
	data-overflow-end={overflowEnd || undefined}
>
	<div class="overflow-x-auto" bind:this={scroller} onscroll={measure}>
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
</div>

<style>
	.table-frame {
		position: relative;
	}

	/* A table wider than its wrapper scrolls inside it while the page does not,
	   so each edge with more columns past it shows a shadow (#1965). Solid inset
	   shadows on overlay strips, not a gradient mask (no gradients): they sit
	   above the rows' own backgrounds and let clicks through. */
	.table-frame::before,
	.table-frame::after {
		content: '';
		position: absolute;
		inset-block: 0;
		z-index: 1;
		width: 1rem;
		pointer-events: none;
		opacity: 0;
		transition: opacity 150ms;
	}

	.table-frame::before {
		left: 0;
		box-shadow: inset 0.75rem 0 0.5rem -0.5rem
			color-mix(in oklab, var(--color-base-content) 30%, transparent);
	}

	.table-frame::after {
		right: 0;
		box-shadow: inset -0.75rem 0 0.5rem -0.5rem
			color-mix(in oklab, var(--color-base-content) 30%, transparent);
	}

	.table-frame[data-overflow-start]::before,
	.table-frame[data-overflow-end]::after {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.table-frame::before,
		.table-frame::after {
			transition: none;
		}
	}
</style>
