<script lang="ts" module>
	const TONES = {
		'base-100': 'bg-base-100',
		'base-200': 'bg-base-200',
		'base-300': 'bg-base-300'
	} as const;

	export type CardTone = keyof typeof TONES;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import clsx from 'clsx';

	/**
	 * The panel surface every page builds sections out of.
	 *
	 * It existed only as a class string before, and the string disagreed with
	 * itself: `card bg-base-100 shadow` in 26 places and `card bg-base-100
	 * shadow-sm` in 24, even though `ui-patterns.md` has always said to use
	 * `shadow`. Both spellings resolve here, so the drift has one place to be
	 * settled rather than fifty.
	 *
	 * `bordered` is the flat variant — a border instead of a shadow, for cards
	 * that sit inside another card or on a tinted section, where a second shadow
	 * reads as a rendering artefact rather than depth.
	 *
	 * Pair with `CardBody`; reach for `InfoCard` instead when the section has a
	 * title, which is most of the time.
	 */
	let {
		tone = 'base-100',
		bordered = false,
		class: className = '',
		children
	}: {
		tone?: CardTone;
		/** Border instead of shadow, for a card nested inside another surface. */
		bordered?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div class={clsx('card', TONES[tone], bordered ? 'border border-base-300' : 'shadow', className)}>
	{@render children()}
</div>
