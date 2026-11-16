<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';

	// The month's poster (#3112). `marketing.read` is what its remote guards on.
	// The staff layout has already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

{#if hasCapability(caps, 'marketing.read')}
	<Button variant="ghost" size="sm" href={resolve('staff/events/poster')}>
		{m.staff_events_print_poster_label()}
	</Button>
{/if}
