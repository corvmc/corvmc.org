<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import VendorCheckIn from '$lib/components/market/VendorCheckIn.svelte';

	const slug = $derived(page.params.slug!);
	const eventId = $derived(page.params.eventId!);
</script>

<VendorCheckIn {eventId} backHref={resolve(`/member/groups/${slug}/markets/${eventId}`)} />
