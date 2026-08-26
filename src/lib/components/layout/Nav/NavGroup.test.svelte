<!--
	Test harness for NavGroup.svelte. Supplies the `children` snippet a spec
	cannot write inline, and lets each case drive the props directly.
-->
<script lang="ts">
	import NavGroup from './NavGroup.svelte';
	import NavItem from './NavItem.svelte';

	let {
		title = 'People',
		items = ['Users', 'Bands'],
		...rest
	}: { title?: string; items?: string[]; [key: string]: unknown } = $props();
</script>

<ul class="menu">
	<NavGroup {title} {...rest}>
		{#each items as label (label)}
			<NavItem href={`/staff/${label.toLowerCase()}`} {label} />
		{/each}
	</NavGroup>
</ul>
