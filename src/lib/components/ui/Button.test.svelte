<!--
	Test harness for Button.svelte. `Tooltip.Root` throws without a
	`Tooltip.Provider` ancestor, which the app supplies once in `+layout.svelte`
	— a spec rendering Button directly has to reproduce that.
-->
<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import Button from './Button.svelte';

	let { label = 'Save', ...rest }: { label?: string; [key: string]: unknown } = $props();
</script>

<Tooltip.Provider delayDuration={300}>
	<Button {...rest}>{label}</Button>
</Tooltip.Provider>
