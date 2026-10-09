<!--
	Test harness for DateRangeFilter. `@container` is what PageContent provides
	on every real page, and FilterBar's layout is container-queried against it.
-->
<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import DateRangeFilter from './DateRangeFilter.svelte';

	let { width }: { width: number } = $props();
	let from = $state('2026-01-01');
	let to = $state('');
</script>

<Tooltip.Provider delayDuration={300}>
	<div class="@container" style="width: {width}px">
		<DateRangeFilter bind:from bind:to defaultFrom="2026-01-01" />
	</div>
</Tooltip.Provider>
