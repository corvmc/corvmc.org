<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import VendorCheckIn from '#lib/components/market/VendorCheckIn.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	const eventId = $derived(params.id);
</script>

<VendorCheckIn
	{eventId}
	parent={[
		{
			label: m.staff_vendors_label(),
			href: withQuery(resolve('/staff/events/[id]', { id: eventId }), 'tab=vendors')
		}
	]}
/>
