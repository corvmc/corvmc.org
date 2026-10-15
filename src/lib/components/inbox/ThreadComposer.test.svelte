<!--
	Test harness for ThreadComposer. Its send button carries a tooltip, and
	`Tooltip.Root` throws without the `Tooltip.Provider` the app's root layout
	supplies.
-->
<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { Tooltip } from 'bits-ui';
	import ThreadComposer from './ThreadComposer.svelte';

	let props: ComponentProps<typeof ThreadComposer> = $props();
</script>

<Tooltip.Provider delayDuration={300}>
	<ThreadComposer {...props} />
</Tooltip.Provider>
