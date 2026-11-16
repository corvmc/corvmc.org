<script lang="ts">
	import CreateGroupAction from '#lib/components/groups/CreateGroupAction.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';

	// `group.read` opens the Clubs page; only `group.manage` creates a club (#3045).
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

{#if hasCapability(caps, 'group.manage')}
	<CreateGroupAction />
{/if}
