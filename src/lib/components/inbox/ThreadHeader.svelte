<script lang="ts">
	/**
	 * The bar above a conversation: who it is with, what it is about, and whatever
	 * actions that side of the inbox offers.
	 *
	 * Shared because both thread panes need the same thing, including the back
	 * button — below `lg` the list pane is hidden, so without it there is no way
	 * out of a conversation on a phone.
	 */
	import type { Snippet } from 'svelte';
	import { IconArrowLeft } from '@tabler/icons-svelte';
	import Button from '$lib/components/shared/Button.svelte';

	let {
		title,
		subtitle,
		subtitleIcon,
		backHref,
		actions,
		children
	}: {
		title: string;
		subtitle?: string;
		/** Drawn before the subtitle — the channel glyph on the staff side. */
		subtitleIcon?: Snippet;
		/** Where the back button goes. Visible below `lg` only. */
		backHref: string;
		/** Trailing controls: status badge, resolve/snooze, and so on. */
		actions?: Snippet;
		/** Anything that belongs under the bar, e.g. a details disclosure. */
		children?: Snippet;
	} = $props();
</script>

<div class="flex flex-col gap-3 border-b border-base-300 pb-3">
	<div class="flex flex-wrap items-center gap-3">
		<Button href={backHref} variant="ghost" size="sm" shape="square" class="lg:hidden">
			<IconArrowLeft size={18} />
		</Button>

		<div class="min-w-0 flex-1">
			<h1 class="truncate text-lg font-bold">{title}</h1>
			{#if subtitle}
				<p class="flex items-center gap-1.5 text-muted text-sm">
					{#if subtitleIcon}{@render subtitleIcon()}{/if}
					<span class="truncate">{subtitle}</span>
				</p>
			{/if}
		</div>

		{#if actions}{@render actions()}{/if}
	</div>

	{#if children}{@render children()}{/if}
</div>
