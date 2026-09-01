<script lang="ts" module>
	/**
	 * The panel's fill. `surface` is the page's own raised panel, the `fill-*`
	 * set is saturated brand with its own ink, and the `tint-*` set is a brand
	 * wash over the page surface — the callout boxes, which keep body ink.
	 */
	const FILLS = {
		none: '',
		/* `surface` is the flat panel — background and border, no shadow. `raised`
		   adds the drop shadow, for a tile that floats on a tinted section rather
		   than sitting in it. The two were separate spellings in the markup and
		   have to stay separate here: defaulting to `raised` silently added a
		   shadow to three flat panels during the migration. */
		surface: 'surface',
		raised: 'surface-raised',
		navy: 'fill-cmc-navy',
		orange: 'fill-cmc-orange',
		'light-blue': 'fill-cmc-light-blue',
		'tint-teal': 'tint-cmc-teal',
		'tint-orange': 'tint-cmc-orange',
		'tint-goldenrod': 'tint-cmc-goldenrod'
	} as const;

	/**
	 * Static maps, never `p-${pad}` — Tailwind v4's scanner only sees class names
	 * written out in full, so a computed one produces no CSS at all. `Button` and
	 * `Table` carry the same note.
	 */
	const PADS = { xs: 'p-3', sm: 'p-4', md: 'p-6', lg: 'p-8' } as const;

	const GAPS = { none: '', '1': 'gap-1', '2': 'gap-2', '3': 'gap-3', '4': 'gap-4' } as const;

	const ALIGNS = {
		/** Stacked and centred — the icon-over-label tile. */
		center: 'flex-col items-center text-center',
		/** Stacked, left-aligned — the pricing panel and the feature list. */
		stack: 'flex-col',
		/** A row: icon beside text — the callout box. */
		start: 'items-start'
	} as const;

	export type TileFill = keyof typeof FILLS;
	export type TilePad = keyof typeof PADS;
	export type TileGap = keyof typeof GAPS;
	export type TileAlign = keyof typeof ALIGNS;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import clsx from 'clsx';

	/**
	 * A single panel inside a `Section` — the fourth member of the public set,
	 * beside `Section`, `Hero` and `SectionHeading`.
	 *
	 * Those three named the page-level shapes; this names the one inside them.
	 * `flex flex-col items-center gap-3 rounded-lg p-6 text-center` appeared six
	 * times across three marketing pages, each carrying its fill as an inline
	 * `style` because the brand palette had no class to reach for. So one tile was
	 * seven utility classes plus a style attribute, repeated — which is the exact
	 * shape `no-utility-soup` exists to catch.
	 *
	 * The fills live in `layout.css` and pair a foreground with every background:
	 * a saturated brand fill needs its own ink, and every inline style this
	 * replaces set `color` beside `background` for that reason.
	 */
	let {
		fill = 'surface',
		pad = 'md',
		gap = '3',
		align = 'center',
		class: className = '',
		children,
		...rest
	}: {
		fill?: TileFill;
		pad?: TilePad;
		gap?: TileGap;
		align?: TileAlign;
		class?: string;
		children: Snippet;
		/** Forwarded to the `<div>` — `style`, `id`, `data-*`, aria attributes. */
		[key: string]: unknown;
	} = $props();
</script>

<div
	{...rest}
	class={clsx('flex rounded-lg', GAPS[gap], PADS[pad], ALIGNS[align], FILLS[fill], className)}
>
	{@render children()}
</div>
