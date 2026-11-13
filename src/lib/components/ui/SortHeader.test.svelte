<!-- Test harness for SortHeader: two columns sharing one sort token, as a page holds it. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import SortHeader from './SortHeader.svelte';

	let { sort: initial = 'name' }: { sort?: string } = $props();
	let sort = $state(untrack(() => initial));
</script>

<table>
	<thead>
		<tr>
			<SortHeader label="Name" field="name" {sort} onsort={(next) => (sort = next)} />
			<SortHeader label="Seen" field="seen" descFirst {sort} onsort={(next) => (sort = next)} />
		</tr>
	</thead>
</table>
<output data-testid="sort">{sort}</output>
