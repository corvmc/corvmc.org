<script lang="ts">
	import type { Snippet } from 'svelte';
	import Badge from '$lib/components/shared/Badge.svelte';

	let {
		title = 'CorvMC',
		badge = 'Staff',
		navigation,
		brand
	}: {
		title?: string;
		badge?: string;
		navigation?: Snippet;
		brand?: Snippet;
	} = $props();
</script>

<aside class="flex h-full max-h-dvh w-64 flex-col overflow-hidden bg-base-200 text-base-content">
	<!-- Logo area (mobile only) -->
	<div class="shrink-0">
		{#if brand}
			{@render brand()}
		{:else}
			<div class="flex items-center gap-2 px-6 py-5">
				<span class="truncate text-xl font-bold">{title}</span>
				<Badge variant="primary">{badge}</Badge>
			</div>
		{/if}

		<div class="tri-stripe"></div>
	</div>

	<!-- Nav links. Two classes carry this and neither is optional:
	     `min-h-0`, because a flex item defaults to `min-height: auto` and refuses
	     to shrink below its content, so without it the list spills past the aside
	     and scrolls `.drawer-side` instead, taking the brand and the mobile panel
	     switcher with it; and `flex-nowrap`, because daisyUI's `.menu` is
	     `flex-flow: column wrap` — once the height is constrained the rows wrap
	     into a second column beyond the 16rem edge and are clipped away entirely
	     rather than scrolling. -->
	<ul class="menu w-full min-h-0 flex-1 flex-nowrap gap-1 overflow-y-auto overscroll-contain">
		{@render navigation?.()}
	</ul>
</aside>
