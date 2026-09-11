<script lang="ts">
	import NavItem from './NavItem.svelte';
	let { label = 'Dashboard' }: { label?: string } = $props();
</script>

<!-- The real frame: daisyUI's `.menu` around the `<li>` NavItem renders. The
     ring is scoped to that selector, so a bare NavItem would prove nothing. -->
<ul class="menu">
	<NavItem href="/member" {label} />
</ul>
