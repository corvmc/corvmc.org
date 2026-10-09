<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import { hasCapability } from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';

	// Its own component so the page keeps one query of its own. The staff layout
	// has already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

<!-- A session you start, not a list you visit, so it is a header action (#1838). -->
{#if hasCapability(caps, 'inventory.manageStock')}
	<Button variant="ghost" size="sm" href={resolve('/staff/inventory/intake')}>Start Intake</Button>
{/if}
