<script lang="ts">
	import { resolve } from '$app/paths';
	import MarketVendorDecisions from '#lib/components/market/MarketVendorDecisions.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	/** A market's vendors, for its vendor host (#2993). `getCommitteeMarketVendors` guards. */
	const params = routeParams('eventId');

	const eventId = $derived(params.eventId);
</script>

<MarketVendorDecisions
	{eventId}
	checkInHref={resolve('/member/volunteer/markets/[eventId]/check-in', { eventId })}
/>
