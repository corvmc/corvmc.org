<!--
	Test harness for a ghost BadgeList on a zebra-striped panel table: the
	roster's role chips (#1967). `data-panel` is what AppShell sets.
-->
<script lang="ts">
	import BadgeList from './BadgeList.svelte';
	import Table from './Table.svelte';
</script>

<div data-panel>
	<Table>
		{#snippet head()}
			<th>Roles</th>
		{/snippet}
		<tr><td><BadgeList items={['Door']} /></td></tr>
		<tr data-testid="striped"><td><BadgeList items={['Booking Lead']} /></td></tr>
	</Table>
</div>
