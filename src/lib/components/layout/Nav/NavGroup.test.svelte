<!--
	Test harness for NavGroup.svelte. Supplies the `children` snippet a spec
	cannot write inline, and lets each case drive the props directly.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import NavGroup from './NavGroup.svelte';
	import NavItem from './NavItem.svelte';

	let {
		title = 'People',
		items = [
			{ href: resolve('/staff/users'), label: 'Users' },
			{ href: resolve('/staff/bands'), label: 'Bands' }
		],
		...rest
	}: {
		title?: string;
		items?: { href: ResolvedPathname; label: string }[];
		[key: string]: unknown;
	} = $props();
</script>

<ul class="menu">
	<NavGroup {title} {...rest}>
		{#each items as item (item.href)}
			<NavItem href={item.href} label={item.label} />
		{/each}
	</NavGroup>
</ul>
