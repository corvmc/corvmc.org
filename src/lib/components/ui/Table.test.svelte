<!--
	Test harness for Table's column packing and scroll cue. `@container` is what
	PageContent provides on every real page, and the packing is container-queried
	against it. `extra` appends nowrap columns to force horizontal overflow.
-->
<script lang="ts">
	import Table from './Table.svelte';

	let { width, extra = 0 }: { width: number; extra?: number } = $props();
	const extras = $derived(Array.from({ length: extra }, (_, i) => i));
</script>

<div class="@container" style="width: {width}px">
	<Table>
		{#snippet head()}
			<th class="w-px">S</th>
			<th>Name</th>
			<th class="cell-num">Count</th>
			{#each extras as i (i)}<th class="whitespace-nowrap">Extra column {i}</th>{/each}
			<th class="w-px"><span class="sr-only">Actions</span></th>
		{/snippet}
		<tr><td colspan={4 + extra} class="cell-group" data-testid="group">Group</td></tr>
		<tr>
			<td class="w-px">x</td>
			<td class="cell-primary" data-testid="primary">The Long-Named Collective of Corvallis</td>
			<td class="cell-num" data-testid="count">12</td>
			{#each extras as i (i)}<td class="whitespace-nowrap">1 of 4 · 1 unfilled</td>{/each}
			<td class="w-px" data-testid="actions"><button>Edit</button></td>
		</tr>
	</Table>
</div>
