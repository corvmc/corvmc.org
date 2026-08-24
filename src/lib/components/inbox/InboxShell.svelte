<script lang="ts">
	/**
	 * The two-pane inbox: conversation list beside the open conversation.
	 *
	 * Shared by `/member/messages` and `/staff/inbox`, which had drifted into two
	 * hand-written copies of the same list-plus-detail page. Both mount it from a
	 * `+layout.svelte` so the list survives navigating between threads, and so
	 * every existing `/…/[id]` URL still resolves — those are deep-linked from
	 * notification emails and the staff user record.
	 *
	 * Responsive rule: one pane at a time below `lg`, both from `lg` up. Which one
	 * shows on a phone is decided by whether a thread is open, so the list is the
	 * page you land on and the thread replaces it.
	 *
	 * Height: `AppShell`'s `<main>` is `flex-1` inside an `h-screen` column and
	 * scrolls itself, so `h-full` here is a definite height. Each pane then scrolls
	 * its own overflow — which is the point, since a conversation and a list of
	 * conversations have no business sharing a scrollbar. `min-h-0` on every link
	 * in that chain is what stops a flex child refusing to shrink below its
	 * content.
	 */
	import type { Snippet } from 'svelte';

	let {
		list,
		children,
		/** Is a conversation open? Drives the one-pane-at-a-time swap below `lg`. */
		threadOpen
	}: {
		list: Snippet;
		children: Snippet;
		threadOpen: boolean;
	} = $props();
</script>

<div class="flex h-full min-h-0 gap-4 py-6">
	<!-- No static display class here: the conditional supplies it. With `flex`
	     baked in as well, `hidden` and `flex` would both be on the element and the
	     winner would come down to Tailwind's emit order rather than intent. -->
	<!-- `@container` so the pane is what container queries resolve against. Shared
	     components size themselves off it — FilterBar collapses its controls behind
	     a disclosure below `@lg` (32rem), which is right here: search plus three
	     selects has never fit a 20–24rem list pane. Without a container ancestor
	     those queries silently never match, which is the same result by accident. -->
	<div
		class="@container w-full min-h-0 flex-col lg:w-80 lg:shrink-0 xl:w-96 {threadOpen
			? 'hidden lg:flex'
			: 'flex'}"
	>
		{@render list()}
	</div>

	<div class="min-w-0 flex-1 flex-col min-h-0 {threadOpen ? 'flex' : 'hidden lg:flex'}">
		{@render children()}
	</div>
</div>
