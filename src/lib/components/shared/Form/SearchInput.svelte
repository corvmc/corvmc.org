<script lang="ts">
	/**
	 * The debounced search box in a `FilterBar`.
	 *
	 * Thirteen list pages had carried their own copy of the same three moving
	 * parts: an immediate `searchText` for the input, a debounced `searchQuery`
	 * for the query, and a `setTimeout` between them with a cleanup effect. The
	 * timer lives here now; a page keeps only the value it actually queries on.
	 *
	 * ```svelte
	 * <FilterBar ...>
	 *   {#snippet search()}
	 *     <SearchInput placeholder="Search members..." onsearch={(q) => { query = q; page = 1; }} />
	 *   {/snippet}
	 * </FilterBar>
	 * ```
	 *
	 * `bind:value` is the immediate text, for a Clear button that has to empty the
	 * field. Setting it from outside also cancels any debounce still in flight, so
	 * a keystroke from just before the reset cannot land on top of it — the pages
	 * this replaced each had to remember a `clearTimeout` in their own
	 * `clearFilters` for that.
	 */
	let {
		value = $bindable(''),
		placeholder = 'Search...',
		delay = 300,
		size = 'sm',
		onsearch,
		...rest
	}: {
		value?: string;
		placeholder?: string;
		/** Milliseconds of quiet before `onsearch` fires. */
		delay?: number;
		size?: 'sm' | 'md';
		/** Called with the debounced text. Reset the page number here too. */
		onsearch?: (query: string) => void;
		[key: string]: unknown;
	} = $props();

	let timer: ReturnType<typeof setTimeout> | undefined;
	/** The last value this component itself produced, to tell typing from a reset. */
	let typed = $state(value);

	function oninput(event: Event) {
		value = (event.currentTarget as HTMLInputElement).value;
		typed = value;
		clearTimeout(timer);
		timer = setTimeout(() => onsearch?.(value), delay);
	}

	$effect(() => {
		if (value !== typed) {
			typed = value;
			clearTimeout(timer);
		}
	});

	// Without this a keystroke on an unmounting page fires `onsearch` into a dead
	// component — which is a state update on a destroyed effect root, not a no-op.
	$effect(() => () => clearTimeout(timer));
</script>

<input
	type="search"
	class="input w-full {size === 'sm' ? 'input-sm' : ''}"
	{placeholder}
	{value}
	{oninput}
	{...rest}
/>
