<!--
	Test harness for TabBar.svelte. Exists so a spec can drive the props without
	reproducing the seven-tab staff user record every time.
-->
<script lang="ts">
	import TabBar from './TabBar.svelte';

	let {
		tabs = [
			{ key: 'overview', label: 'Overview' },
			{ key: 'space', label: 'Space' },
			{ key: 'bands', label: 'Bands' }
		],
		active = 'overview',
		...rest
	}: { tabs?: unknown[]; active?: string; [key: string]: unknown } = $props();
</script>

<TabBar tabs={tabs as never} {active} {...rest} />
