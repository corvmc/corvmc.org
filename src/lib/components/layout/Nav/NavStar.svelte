<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconStar, IconStarFilled } from '@tabler/icons-svelte';

	let {
		starred,
		describedby,
		ontoggle
	}: {
		starred: boolean;
		/** The row label's id. The name stays "Star" so it never contains a label. */
		describedby: string;
		ontoggle: () => void;
	} = $props();
</script>

<!-- Named "Star" alone, not "Star Credits": Playwright matches names by
     substring, and e2e's `getByRole('button', { name: 'Edit' })` would find
     "Star Credits". The row label reaches assistive tech as the description. -->
<button
	type="button"
	class="nav-star btn btn-square btn-ghost btn-xs"
	aria-label={m.layout_nav_star_label()}
	aria-describedby={describedby}
	aria-pressed={starred}
	onclick={ontoggle}
>
	{#if starred}<IconStarFilled />{:else}<IconStar />{/if}
</button>

<style>
	/* Sits over the end of the row's link, which leaves room for it. Keyed to
	   that link rather than the `li`, which also holds a collapsible's children.
	   Always shown on a device with no hover: an invisible tap target is worse. */
	.nav-star {
		position: absolute;
		inset-inline-end: 0.25rem;
		top: 0.25rem;
		opacity: 0;
	}

	:global(a:hover) + .nav-star,
	:global(a:focus-visible) + .nav-star,
	.nav-star:hover,
	.nav-star:focus-visible {
		opacity: 1;
	}

	@media (hover: none) {
		.nav-star {
			opacity: 1;
		}
	}

	.nav-star :global(svg) {
		width: 14px;
		height: 14px;
	}
</style>
