<script lang="ts" module>
	const TINTS = {
		none: '',
		primary: 'section-tint-primary',
		secondary: 'section-tint-secondary',
		success: 'section-tint-success',
		warning: 'section-tint-warning',
		info: 'section-tint-info'
	} as const;

	const PADS = { sm: 'py-10', md: 'py-16', lg: 'py-24' } as const;

	const WIDTHS = {
		'2xl': 'max-w-2xl mx-auto',
		'3xl': 'max-w-3xl mx-auto',
		'5xl': 'max-w-5xl mx-auto',
		full: ''
	} as const;

	export type SectionTint = keyof typeof TINTS;
	export type SectionPad = keyof typeof PADS;
	export type SectionWidth = keyof typeof WIDTHS;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import clsx from 'clsx';

	/**
	 * A band of the public site: a full-bleed tinted `<section>` with a centred
	 * measure inside it.
	 *
	 * The public pages already agreed on this shape — `<section class="section-tint-* * py-16 px-6">` wrapping `<div class="max-w-5xl mx-auto">`, fourteen times —
	 * they just never named it, so the tint, the padding and the measure could
	 * each drift on their own.
	 *
	 * The tints are the brand washes defined in `layout.css`, not arbitrary
	 * colours. Alternating them down a page is what gives the marketing site its
	 * rhythm; picking one per section by hand is what loses it.
	 */
	let {
		tint = 'none',
		pad = 'md',
		width = '5xl',
		center = false,
		sunburst = false,
		class: className = '',
		children
	}: {
		tint?: SectionTint;
		pad?: SectionPad;
		/** The inner measure. `full` skips the wrapper's max-width. */
		width?: SectionWidth;
		center?: boolean;
		/** The radiating brand backdrop — heroes only. */
		sunburst?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<section
	class={clsx(
		sunburst && 'sunburst',
		TINTS[tint],
		PADS[pad],
		'px-6',
		center && 'text-center',
		className
	)}
>
	<div class={WIDTHS[width]}>
		{@render children()}
	</div>
</section>
