<script lang="ts">
	// Test-only harness. `EntityIdentity` in cell mode renders *two sibling roots*
	// with no wrapper, so the structural assertion needs it inside a real
	// `<td class="cell-primary">` — which is the whole point of the contract.
	// It also needs a viewer in context to derive links at all.
	import EntityIdentity from './EntityIdentity.svelte';
	import EntityViewer from './EntityViewer.svelte';
	import { capabilities as CAPS } from '$lib/config';
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

	// `isStaff` and the capability set move together: EntityViewer feeds
	// entity-href, which decides the staff arm per route now, so a harness that
	// says "is staff" while holding nothing would be exercising a viewer that
	// cannot exist. Derived from config so a new capability cannot quietly
	// narrow what these tests cover.
	const allCapabilities = Object.entries(CAPS).flatMap(([r, actions]) =>
		(actions as readonly string[]).map((a) => `${r}.${a}`)
	);
</script>

<EntityViewer {panel} {userId} {isStaff} {bands} capabilities={isStaff ? allCapabilities : []}>
	<table>
		<tbody>
			<tr>
				<td class="cell-primary"><EntityIdentity {ref} {size} {avatar} {status} /></td>
			</tr>
		</tbody>
	</table>
</EntityViewer>
