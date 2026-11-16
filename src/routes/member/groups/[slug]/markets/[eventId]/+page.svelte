<script lang="ts">
	import { resolve } from '$app/paths';
	import MarketVendorDecisions from '#lib/components/market/MarketVendorDecisions.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug', 'eventId');

	const slug = $derived(params.slug);
	const eventId = $derived(params.eventId);
</script>

<MarketVendorDecisions
	{eventId}
	checkInHref={resolve('/member/groups/[slug]/markets/[eventId]/check-in', { slug, eventId })}
/>
