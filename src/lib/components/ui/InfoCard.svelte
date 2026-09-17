<script lang="ts">
	import type { Snippet } from 'svelte';
	import Card from './Card/Card.svelte';
	import CardBody from './Card/CardBody.svelte';
	import CardTitle from './Card/CardTitle.svelte';

	/**
	 * A titled card — the default section on every detail page.
	 *
	 * Thin composition over `Card` / `CardBody` / `CardTitle`. Reach for those
	 * directly only when the section has no title, or when the body needs the
	 * `row` / `center` layouts.
	 */
	let {
		title,
		state,
		class: extraClass = '',
		children,
		action,
		header
	}: {
		title: string;
		/**
		 * What this section's contents amount to — "1 of 4 unfilled", "6 · 24.5
		 * hrs", "Empty". A console section states its own state in its heading so
		 * the page can be scanned without being read; passing it here keeps the
		 * separator and weight in one place instead of in 26 copies.
		 */
		state?: string | number;
		class?: string;
		children: Snippet;
		/** A control beside the title — usually a link into the full queue. */
		action?: Snippet;
		/**
		 * Replaces the whole heading. For a genuinely bespoke one, like a title
		 * with an `Action` and its modal form; `state` and `action` cover the rest.
		 */
		header?: Snippet<[title: string]>;
	} = $props();
</script>

<Card class={extraClass}>
	<CardBody>
		{#if header}
			{@render header(title)}
		{:else if action}
			<div class="flex items-center justify-between gap-2">
				<CardTitle>
					{title}
					{#if state}<span class="text-muted font-normal">· {state}</span>{/if}
				</CardTitle>
				{@render action()}
			</div>
		{:else}
			<CardTitle>
				{title}
				{#if state}<span class="text-muted font-normal">· {state}</span>{/if}
			</CardTitle>
		{/if}
		{@render children()}
	</CardBody>
</Card>
