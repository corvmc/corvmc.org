<script lang="ts">
	/**
	 * Single stat for dashboards.
	 *
	 * `size` exists because two pages hand-rolled the raw daisyUI `stat` markup
	 * purely to get a smaller value — the default `stat-value` is large enough
	 * that three of them in a row overflow a narrow panel column. Reach for
	 * `size="sm"` rather than rebuilding the card.
	 */
	let {
		title,
		value,
		size = 'md',
		class: extraClass = '',
		valueClass = ''
	}: {
		title: string;
		value: string | number;
		/** `'sm'` renders the value at text-2xl; `'md'` keeps daisyUI's default. */
		size?: 'sm' | 'md';
		class?: string;
		/** Extra classes on the value line, e.g. `capitalize`. */
		valueClass?: string;
	} = $props();
</script>

<div class="stat bg-base-100 rounded-box shadow {extraClass}">
	<div class="stat-title">{title}</div>
	<div class="stat-value {size === 'sm' ? 'text-2xl' : ''} {valueClass}">{value}</div>
</div>
