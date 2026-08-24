<script lang="ts">
	// Test-only harness. `EntityIdentity` in cell mode renders *two sibling roots*
	// with no wrapper, so the structural assertion needs it inside a real
	// `<td class="cell-primary">` — which is the whole point of the contract.
	// It also needs a viewer in context to derive links at all.
	import EntityIdentity from './EntityIdentity.svelte';
	import EntityViewer from './EntityViewer.svelte';
	import type { EntityRef, Panel } from '$lib/types/entity';

	let {
		ref,
		panel = 'staff',
		isStaff = true,
		userId = 'user-1',
		bands = [],
		size = 'sm',
		avatar = undefined,
		status = false
	}: {
		ref: EntityRef;
		panel?: Panel;
		isStaff?: boolean;
		userId?: string | null;
		bands?: { id: string }[];
		size?: 'sm' | 'md';
		avatar?: boolean;
		status?: boolean;
	} = $props();
</script>

<EntityViewer {panel} {userId} {isStaff} {bands}>
	<table>
		<tbody>
			<tr>
				<td class="cell-primary"><EntityIdentity {ref} {size} {avatar} {status} /></td>
			</tr>
		</tbody>
	</table>
</EntityViewer>
