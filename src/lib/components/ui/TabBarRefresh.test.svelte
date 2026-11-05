<!-- Test harness: a TabBar whose tabs come from an awaited read. -->
<script lang="ts">
	import TabBar from './TabBar.svelte';

	let { read }: { read: Promise<number> } = $props();

	const count = $derived(await read);
	const tabs = $derived(['a', 'b', 'c'].map((key) => ({ key, label: `${key} ${count}` })));
</script>

<TabBar {tabs} active="a" />
