<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import InfoCard from '../InfoCard.svelte';
	import Alert from '../Alert.svelte';

	/**
	 * A titled card whose body is one remote query — the "related records"
	 * section of a detail page.
	 *
	 * Promoted from `staff/users/[id]/panels/AsyncCard.svelte`, which was already
	 * exactly this component, privately, in one route folder.
	 *
	 * Each section loads independently: a slow subscription lookup must not blank
	 * the reservations beside it. The `{:catch}` is load-bearing — without it a
	 * failed query renders an empty card, indistinguishable from "this record has
	 * none of these", which is the bug the Payment Records card shipped with.
	 *
	 * Empty states stay with the caller: "no bands" and "no payments" want
	 * different words, and half of them want a link out.
	 */
	let {
		title,
		result,
		class: className = '',
		header,
		children
	}: {
		title: string;
		result: Promise<T>;
		class?: string;
		header?: Snippet<[title: string]>;
		children: Snippet<[T]>;
	} = $props();
</script>

<InfoCard {title} class={className} {header}>
	{#await result}
		<div class="flex justify-center py-8">
			<span class="loading loading-spinner loading-sm"></span>
		</div>
	{:then value}
		{@render children(value)}
	{:catch}
		<Alert type="warning">Could not load {title.toLowerCase()}.</Alert>
	{/await}
</InfoCard>
