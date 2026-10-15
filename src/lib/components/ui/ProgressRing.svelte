<script lang="ts">
	/**
	 * A small ring that fills clockwise. An SVG stroke rather than daisyUI's
	 * `radial-progress`, which paints with a conic-gradient (no gradients).
	 * `total` of 0 draws a dashed empty ring: nothing to measure yet.
	 */
	let {
		value,
		total,
		size = 20,
		label
	}: {
		value: number;
		total: number;
		size?: number;
		/** Accessible name; defaults to "N of M done". */
		label?: string;
	} = $props();

	const R = 8;
	const C = 2 * Math.PI * R;
	const ratio = $derived(total > 0 ? Math.min(1, Math.max(0, value / total)) : 0);
	const name = $derived(label ?? (total > 0 ? `${value} of ${total} done` : 'Nothing to do yet'));
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 20 20"
	role="img"
	aria-label={name}
	class="shrink-0 -rotate-90"
>
	<title>{name}</title>
	<circle
		cx="10"
		cy="10"
		r={R}
		fill="none"
		stroke-width="3"
		class="stroke-base-300"
		stroke-dasharray={total > 0 ? undefined : '2 2'}
	/>
	{#if ratio > 0}
		<circle
			cx="10"
			cy="10"
			r={R}
			fill="none"
			stroke-width="3"
			stroke-linecap="round"
			class={ratio === 1 ? 'stroke-success' : 'stroke-primary'}
			stroke-dasharray="{C * ratio} {C}"
		/>
	{/if}
</svg>
