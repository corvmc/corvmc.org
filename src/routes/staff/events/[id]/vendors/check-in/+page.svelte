<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import VendorCheckIn from '$lib/components/market/VendorCheckIn.svelte';

	const eventId = $derived(page.params.id!);
</script>

<VendorCheckIn
	{eventId}
	parent={[
		{ label: m.staff_vendors(), href: resolve('/staff/events/[id]/vendors', { id: eventId }) }
	]}
/>
