<!--
	Test harness for Table's column packing. `@container` is what PageContent
	provides on every real page, and the packing is container-queried against it.
-->
<script lang="ts">
	import Table from './Table.svelte';

	let { width }: { width: number } = $props();
</script>

<div class="@container" style="width: {width}px">
	<Table>
		{#snippet head()}
			<th class="w-px">S</th>
			<th>Name</th>
			<th class="cell-num">Count</th>
			<th class="w-px"><span class="sr-only">Actions</span></th>
		{/snippet}
		<tr><td colspan="4" class="cell-group" data-testid="group">Group</td></tr>
		<tr>
			<td class="w-px">x</td>
			<td class="cell-primary" data-testid="primary">The Long-Named Collective of Corvallis</td>
			<td class="cell-num" data-testid="count">12</td>
			<td class="w-px" data-testid="actions"><button>Edit</button></td>
		</tr>
	</Table>
</div>
