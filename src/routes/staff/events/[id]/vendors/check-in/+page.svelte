<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import VendorCheckIn from '$lib/components/market/VendorCheckIn.svelte';

	const eventId = $derived(page.params.id!);
</script>

<VendorCheckIn {eventId} backHref={resolve(`/staff/events/${eventId}/vendors`)} />
