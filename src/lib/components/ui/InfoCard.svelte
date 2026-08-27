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
		class: extraClass = '',
		children,
		header
	}: {
		title: string;
		class?: string;
		children: Snippet;
		/** Replaces the default `CardTitle`, e.g. to add an action beside it. */
		header?: Snippet<[title: string]>;
	} = $props();
</script>

<Card class={extraClass}>
	<CardBody>
		{#if header}
			{@render header(title)}
		{:else}
			<CardTitle>{title}</CardTitle>
		{/if}
		{@render children()}
	</CardBody>
</Card>
