<script lang="ts">
	/**
	 * The page editor's frame: the band's page at full width, with a style pane
	 * beside it.
	 *
	 * The editor used to sit in a `PageContent width="2xl"` with the page itself
	 * inside a card inside a 42rem scroll box — a page meant to be judged at full
	 * width, previewed at half of it. So this escapes `AppShell`'s `<main>`
	 * padding the same way `PageHeader` does (`-mx-6`, plus `-mb-6` at the foot)
	 * and gives the canvas everything that is left.
	 *
	 * Height: `<main>` is `flex-1 overflow-y-auto` inside an `h-screen` column, so
	 * `h-full` here is a definite height and each pane scrolls its own overflow —
	 * the same arrangement `InboxShell` documents, and for the same reason: a page
	 * and the CSS that styles it have no business sharing a scrollbar.
	 *
	 * Responsive rule, also `InboxShell`'s: both panes from `lg` up, one at a time
	 * below it. On a phone the canvas is the page you land on and the style pane
	 * replaces it.
	 */
	import type { Snippet } from 'svelte';

	let {
		canvas,
		sidebar,
		/**
		 * Is the style pane showing? `null` means nobody has said, and the
		 * breakpoint decides in CSS — open beside the canvas where there is room,
		 * closed on a phone. No width to measure, and nothing to hydrate wrong.
		 */
		open
	}: {
		canvas: Snippet;
		sidebar: Snippet;
		open: boolean | null;
	} = $props();

	const canvasClass = $derived(open === true ? 'hidden lg:block' : 'block');
	const sidebarClass = $derived(open === null ? 'hidden lg:flex' : open ? 'flex' : 'hidden');
</script>

<div class="-mx-6 -mb-6 flex h-full min-h-0">
	<!-- The canvas paints white behind the page: the themes bring their own
	     background, and a dark theme on the app's light surface looks like a bug.
	     No static display class — the conditional supplies it, so `hidden` and
	     `flex` are never both on the element with Tailwind's emit order deciding
	     which wins. -->
	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto bg-white {canvasClass}">
		{@render canvas()}
	</div>

	<div
		class="min-h-0 w-full flex-col overflow-y-auto border-base-300 bg-base-100 lg:w-88 lg:shrink-0 lg:border-l {sidebarClass}"
	>
		{@render sidebar()}
	</div>
</div>
