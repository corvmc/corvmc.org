<script lang="ts">
	// Test-only harness: EntityChip derives its href from viewer context, so it
	// needs a provider above it to render anything but public links.
	import EntityChip from './EntityChip.svelte';
	import EntityViewer from './EntityViewer.svelte';
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
</script>

<EntityViewer {panel} {userId} {isStaff}>
	<EntityChip {ref} {status} {preview} />
</EntityViewer>
