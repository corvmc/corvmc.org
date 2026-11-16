<script lang="ts" module>
	// Literal class names: Tailwind only emits what it sees written out in full.
	const SEARCH_WIDTHS = {
		fixed: '@lg:w-80',
		wide: '@lg:w-96',
		content: '@lg:w-auto'
	} as const;
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Filter toolbar layout. Owns no filter state — pages keep their own `$state`
	 * and pass the controls in.
	 *
	 * Nothing collapses: search, `children` and Clear stay visible at every width,
	 * wrapping onto further rows on a narrow container. Secondary filters go in
	 * `menu`, a "Filters" popover that stays one button at every width.
	 */
	import type { Snippet } from 'svelte';
	import { Popover } from 'bits-ui';
	import { IconFilter } from '@tabler/icons-svelte';
	import Button, { setDefaultButtonSize } from './Button.svelte';

	let {
		search,
		children,
		menu,
		actions,
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
		/** Inline filters; they wrap rather than collapse on a narrow container. */
		children?: Snippet;
		/** Secondary filters, behind the "Filters" button. */
		menu?: Snippet;
		/** The current view's own actions, such as its create button, at the row's end. */
		actions?: Snippet;
		/** Every active filter, search included: whether Clear renders. */
		activeCount?: number;
		/** Active filters inside `menu`: the badge on its button. */
		menuCount?: number;
		onclear?: () => void;
	} = $props();

	// A view's actions sit in the row at the size of its controls, as they did in the header.
	setDefaultButtonSize('sm');

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

	<!-- `contents`: as a flex item this wrapper would shrink and wrap its own
	     children; stepping out of layout lets them wrap with the row. Controls
	     size to their content: daisyUI's 20rem default outgrows a phone. -->
	{#if children}
		<div class="contents [&_.input]:w-auto [&_.select]:w-auto [&_.select]:max-w-full">
			{@render children()}
		</div>
	{/if}
	{#if menu}
		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="sm">
						<IconFilter size={16} />
						{m.ui_filters_label()}
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
	{/if}
	{#if showClear}
		<Button variant="ghost" size="sm" onclick={onclear}>{m.ui_clear_label()}</Button>
	{/if}

	{#if actions}
		<div class="ml-auto flex flex-wrap items-center gap-2">{@render actions()}</div>
	{/if}
</div>
