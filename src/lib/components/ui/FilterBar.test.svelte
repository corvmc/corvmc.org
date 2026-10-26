<!--
	Test harness for FilterBar's menu. `@container` is what PageContent provides
	on every real page, and FilterBar's layout is container-queried against it.
-->
<script lang="ts">
	import FilterBar from './FilterBar.svelte';
	import Select from './Form/Select.svelte';

	let { width = 1100 }: { width?: number } = $props();
	let category = $state('');
	let tier = $state('');
	let cleared = $state(0);

	const menuCount = $derived(tier ? 1 : 0);
	const activeCount = $derived((category ? 1 : 0) + menuCount);
</script>

<div class="@container" style="width: {width}px">
	<FilterBar
		{activeCount}
		{menuCount}
		onclear={() => {
			category = '';
			tier = '';
			cleared++;
		}}
	>
		{#snippet search()}
			<input type="search" class="input w-full input-sm" aria-label="Search" />
		{/snippet}
		<Select size="sm" aria-label="Category" bind:value={category}>
			<option value="">All categories</option>
			<option value="amps">Amps</option>
		</Select>
		{#snippet menu()}
			<Select size="sm" aria-label="Tier" bind:value={tier}>
				<option value="">All tiers</option>
				<option value="premium">Premium</option>
			</Select>
		{/snippet}
	</FilterBar>
	<output data-testid="cleared">{cleared}</output>
</div>
