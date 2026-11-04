<!--
	Test harness for the star toggle on Nav.Item. Holds the starred flag the way
	a panel layout does, so a click round-trips through `onstar`.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import NavItem from './NavItem.svelte';

	let { starrable = true }: { starrable?: boolean } = $props();
	let starred = $state(false);
</script>

<ul class="menu">
	<NavItem
		href={resolve('staff/payments')}
		label="Payments"
		{starred}
		onstar={starrable ? () => (starred = !starred) : undefined}
	/>
</ul>
