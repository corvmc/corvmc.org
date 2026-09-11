<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import SearchSelect from './SearchSelect.svelte';

	let {
		search,
		inModal = false,
		inLabel = false,
		onselect
	}: {
		search: (q: string) => Promise<{ id: string; name: string }[]>;
		inModal?: boolean;
		inLabel?: boolean;
		onselect?: (v: unknown) => void;
	} = $props();

	let value = $state<{ id: string; name: string } | null>(null);
	$effect(() => {
		if (value) onselect?.(value);
	});
</script>

{#snippet picker()}
	{#if inLabel}
		<label class="fieldset w-full">
			<span class="fieldset-legend">To</span>
			<SearchSelect bind:value {search} />
		</label>
	{:else}
		<SearchSelect bind:value {search} />
	{/if}
{/snippet}

{#if inModal}
	<Modal open title="Message a member">{@render picker()}</Modal>
{:else}
	{@render picker()}
{/if}
