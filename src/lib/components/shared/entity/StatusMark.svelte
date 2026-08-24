<script lang="ts">
	import { variants, statusLabel } from '../StatusBadge.svelte';
	import { toneFor } from './registry';

	/**
	 * A status glyph on a tinted region, sized to sit at the trailing edge of a
	 * chip.
	 *
	 * Stretches to the chip's full height and reaches its border, so the chip
	 * reads as two-tone rather than as a label with a badge stuck on it. The
	 * parent supplies the pill shape and `overflow-hidden`; this fills whatever
	 * corner it lands in.
	 *
	 * `StatusBadge`'s icon-only form tints the glyph and leaves the background
	 * alone, which works on a card — the media is already ringed in the same tone
	 * — but on a chip the mark is the only signal, and a tinted glyph on the
	 * chip's own fill was too quiet to catch.
	 *
	 * Named from `statusLabel()` rather than a local copy, so this and
	 * `StatusBadge` cannot disagree about what a status is called.
	 */
	let {
		status,
		class: className = ''
	}: {
		status: string;
		class?: string;
	} = $props();

	const variant = $derived(variants[status]);
	const fill = $derived(toneFor(status)?.fill ?? '');
	const label = $derived(statusLabel(status));
</script>

{#if variant}
	<span
		class="tooltip flex shrink-0 items-center self-stretch px-1.5 {fill} {className}"
		data-tip={label}
		role="img"
		aria-label={label}
	>
		<variant.icon size={14} />
	</span>
{/if}
