<!--
	Test harness for StatusBadge's `responsive` form. `@container` is what
	PageContent provides on every real page, and `group/row` is what a table row
	carries so a focused link in it can open the badge's tooltip.
-->
<script lang="ts">
	import StatusBadge from './StatusBadge.svelte';

	let { width, responsive = true }: { width: number; responsive?: boolean } = $props();
</script>

<div class="@container" style="width: {width}px">
	<table>
		<tbody>
			<tr class="group/row">
				<td><StatusBadge status="no_show" label {responsive} /></td>
				<td><a href="#row">Open reservation</a></td>
			</tr>
		</tbody>
	</table>
</div>
