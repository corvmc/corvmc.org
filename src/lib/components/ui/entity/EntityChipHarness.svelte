<script lang="ts">
	// Test-only harness: EntityChip derives its href from viewer context, so it
	// needs a provider above it to render anything but public links.
	import EntityChip from './EntityChip.svelte';
	import EntityViewer from './EntityViewer.svelte';
	import { capabilities as CAPS } from '$lib/config';
	import type { EntityRef, Panel } from '$lib/types/entity';

	let {
		ref,
		panel = 'staff',
		isStaff = true,
		userId = 'user-1',
		status = true,
		preview = true
	}: {
		ref: EntityRef;
		panel?: Panel;
		isStaff?: boolean;
		userId?: string | null;
		status?: boolean;
		preview?: boolean;
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

<EntityViewer {panel} {userId} {isStaff} capabilities={isStaff ? allCapabilities : []}>
	<EntityChip {ref} {status} {preview} />
</EntityViewer>
