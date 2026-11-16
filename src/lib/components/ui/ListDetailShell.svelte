<script lang="ts">
	/**
	 * A list beside the record open from it, mounted from a `+layout.svelte` so the
	 * list survives moving between records and every `/…/[id]` URL still resolves.
	 * Below `lg` one pane shows at a time, chosen by `open`; from `lg` both do.
	 * Every link in the flex chain carries `min-h-0`, or a pane refuses to shrink
	 * below its content and stops scrolling itself. ui-patterns.md, "List and
	 * detail", has the two modes.
	 */
	import type { Snippet } from 'svelte';

	let {
		list,
		children,
		toolbar,
		open,
		mode = 'panes'
	}: {
		list: Snippet;
		children: Snippet;
		/** One bar across both panes, above them. `panes` mode only. */
		toolbar?: Snippet;
		/** Is a record open? Decides which pane shows below `lg`. */
		open: boolean;
		/**
		 * `panes`: both panes always from `lg`, inside a padded frame (an inbox).
		 * `pages`: each pane is a whole page (PageHeader + PageContent) scrolling
		 * itself; with nothing open the list is the full width and the detail pane
		 * is absent.
		 */
		mode?: 'panes' | 'pages';
	} = $props();

	const pages = $derived(mode === 'pages');
</script>

{#if pages}
	<!-- `-mx-6 px-6` takes the frame's padding into each pane, so a PageHeader's
	     `-mx-6` bleed lands inside its own scroll box instead of overflowing it.
	     Block panes, not flex columns: a `PageContent` width is `mx-auto`, and an
	     auto-margined flex item shrinks to its content instead of filling. -->
	<div class="flex h-full min-h-0">
		<div
			data-pane="list"
			class="@container -mx-6 min-h-0 w-full overflow-y-auto px-6 {open
				? 'hidden lg:mr-0 lg:block lg:w-96 lg:shrink-0 lg:border-r lg:border-base-300 xl:w-[28rem]'
				: 'block'}"
		>
			{@render list()}
		</div>
		{#if open}
			<div data-pane="detail" class="-mx-6 min-h-0 min-w-0 flex-1 overflow-y-auto px-6 lg:ml-0">
				{@render children()}
			</div>
		{:else}
			{@render children()}
		{/if}
	</div>
{:else if toolbar}
	<div class="flex h-full min-h-0 flex-col gap-3 py-6">
		{@render toolbar()}
		<div class="flex min-h-0 flex-1 gap-4">{@render panes()}</div>
	</div>
{:else}
	<div class="flex h-full min-h-0 gap-4 py-6">{@render panes()}</div>
{/if}

{#snippet panes()}
	<!-- No static display class: the conditional supplies it, so `hidden` and
	     `flex` never sit on one element with Tailwind's emit order deciding.
	     `@container` makes the pane what shared components' container queries
	     resolve against. -->
	<div
		data-pane="list"
		class="@container min-h-0 w-full flex-col lg:w-80 lg:shrink-0 xl:w-96 {open
			? 'hidden lg:flex'
			: 'flex'}"
	>
		{@render list()}
	</div>

	<div
		data-pane="detail"
		class="min-h-0 min-w-0 flex-1 flex-col {open ? 'flex' : 'hidden lg:flex'}"
	>
		{@render children()}
	</div>
{/snippet}
