<!--
	Test harness for ListFilters: holds the bound values and prints them, so a
	spec can read what the row wrote back to the page.
-->
<script lang="ts">
	import ListFilters from './ListFilters.svelte';
	import type { DateRange } from './DateFilter.svelte';

	let { dot = false }: { dot?: boolean } = $props();
	let type = $state<'a' | 'b' | ''>('');
	let search = $state('');
	let range = $state<DateRange>('from_today');
	let from = $state('');
	let to = $state('');
	let status = $state<'open' | 'closed' | ''>('');
	let page = $state(4);
</script>

<div class="@container" style="width: 1100px">
	<ListFilters
		types={[
			{ value: 'a', label: 'A' },
			{ value: 'b', label: 'B' }
		]}
		typeAllLabel="All"
		typeLabel="Type"
		bind:type
		searchPlaceholder="Search"
		bind:search
		bind:range
		bind:from
		bind:to
		statuses={[
			{ value: 'open', label: 'Open (2)' },
			{ value: 'closed', label: 'Closed (1)' }
		]}
		bind:status
		statusDot={dot ? 'Overdue' : undefined}
		onstatus={(next) => {
			if (next === 'closed') range = 'any';
		}}
		bind:page
	/>
</div>
<output data-testid="state">{JSON.stringify({ type, search, range, status, page })}</output>
