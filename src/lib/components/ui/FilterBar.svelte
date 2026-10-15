<script lang="ts" module>
	// Literal class names: Tailwind only emits what it sees written out in full.
	const SEARCH_WIDTHS = {
		fixed: '@lg:w-80',
		wide: '@lg:w-96',
		content: '@lg:w-auto'
	} as const;
</script>

<script lang="ts">
	/**
	 * Filter toolbar layout. Owns no filter state — pages keep their own `$state`
	 * and pass the controls in.
	 *
	 * Search stays visible at every width. Secondary filters go in `menu`, a
	 * "Filters" popover that stays one button at every width; `children` are the
	 * primary ones and sit inline. A page with no `menu` keeps the older layout,
	 * where `children` collapse behind a "Filters" disclosure below `@lg`.
	 */
	import type { Snippet } from 'svelte';
	import { Popover } from 'bits-ui';
	import { IconFilter } from '@tabler/icons-svelte';
	import Button from './Button.svelte';

	let {
		search,
		children,
		menu,
		activeCount = 0,
		menuCount = 0,
		onclear,
		searchWidth = 'fixed'
	}: {
		/** Always visible; full width below `@lg`. */
		search?: Snippet;
		/**
		 * `@lg` and up: `fixed` is 20rem, sized for one text input; `wide` is 24rem,
		 * for an input with a button joined to it; `content` fits the snippet.
		 */
		searchWidth?: keyof typeof SEARCH_WIDTHS;
		/** Inline filters. Without `menu`, collapsed on narrow containers. */
		children?: Snippet;
		/** Secondary filters, behind the "Filters" button. */
		menu?: Snippet;
		/** Every active filter, search included: whether Clear renders. */
		activeCount?: number;
		/** Active filters inside `menu`: the badge on its button. */
		menuCount?: number;
		onclear?: () => void;
	} = $props();

	const uid = $props.id();
	const showClear = $derived(activeCount > 0 && !!onclear);
</script>

{#snippet badge(count: number)}
	{#if count > 0}
		<span class="badge badge-sm badge-primary">{count}</span>
	{/if}
{/snippet}

<div class="mb-4 flex flex-wrap items-end gap-2">
	{#if search}
		<div class="w-full {SEARCH_WIDTHS[searchWidth]}">{@render search()}</div>
	{/if}

	{#if menu}
		{#if children}
			<div class="contents [&_.input]:w-auto [&_.select]:w-auto">{@render children()}</div>
		{/if}
		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="sm">
						<IconFilter size={16} />
						Filters
						{@render badge(menuCount)}
					</Button>
				{/snippet}
			</Popover.Trigger>
			<!-- No Portal: the panel theme is scoped to `[data-panel]`, and a popover
			     moved to <body> would render its controls unthemed. -->
			<Popover.Content
				sideOffset={4}
				align="start"
				class="z-1000 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg [&_.input]:w-full [&_.select]:w-full"
			>
				{@render menu()}
			</Popover.Content>
		</Popover.Root>
		{#if showClear}
			<Button variant="ghost" size="sm" onclick={onclear}>Clear</Button>
		{/if}
	{:else if children}
		<!-- Peer checkbox rather than <details>: <details> cannot be reliably
		     forced open by CSS at wide widths across engines. -->
		<input id="filters-{uid}" type="checkbox" class="peer hidden" />
		<label for="filters-{uid}" class="btn btn-ghost btn-sm @lg:hidden">
			<IconFilter size={16} />
			Filters
			{@render badge(activeCount)}
		</label>

		<!-- `hidden` keeps the controls mounted so their state survives collapsing.
		     Tailwind emits the `@lg:` variant after `hidden`, so it wins on wide
		     containers. `contents` rather than `flex` there: as a flex *item* this
		     wrapper shrinks and wraps its own children onto extra lines, so at wide
		     widths it steps out of layout and the controls join the parent's row. -->
		<!-- Controls size to their content at wide widths: daisyUI's 20rem default
		     made three selects outgrow the row and wrap. -->
		<div
			class="hidden w-full flex-wrap items-end gap-2 peer-checked:flex @lg:contents @lg:[&_.input]:w-auto @lg:[&_.select]:w-auto"
		>
			{@render children()}
			{#if showClear}
				<Button variant="ghost" size="sm" onclick={onclear}>Clear</Button>
			{/if}
		</div>
	{/if}
</div>
