<script lang="ts">
	import type { Snippet } from 'svelte';
	import PageHeader from './PageHeader.svelte';
	import PageContent from './PageContent.svelte';

	/**
	 * A record's frame: a page header and body, or, in a side panel whose modal
	 * already names the record, a header row with `actions` at its end.
	 */
	let {
		variant = 'page',
		title,
		subtitle,
		header,
		actions,
		children
	}: {
		variant?: 'page' | 'panel';
		title: string;
		subtitle?: string;
		header?: Snippet;
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

{#if variant === 'page'}
	<PageHeader width="3xl" {title} {subtitle}>{@render header?.()}</PageHeader>
	<PageContent width="3xl">{@render children()}</PageContent>
{:else}
	<!-- Its own container, so the tables' column tiers track the panel's width. -->
	<div class="@container space-y-6">
		<div class="flex flex-wrap items-center gap-2">
			{@render header?.()}
			<span class="ms-auto">{@render actions?.()}</span>
		</div>
		{@render children()}
	</div>
{/if}
