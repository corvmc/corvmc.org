<!--
	Test harness: Button's tooltip throws without a `Tooltip.Provider`, which the
	app mounts in the root layout.
-->
<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import ProductionTab from './ProductionTab.svelte';

	let { eventId }: { eventId: string } = $props();
</script>

<Tooltip.Provider delayDuration={300}>
	<ProductionTab {eventId} />
</Tooltip.Provider>
