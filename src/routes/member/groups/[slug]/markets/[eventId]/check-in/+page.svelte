<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import VendorCheckIn from '#lib/components/market/VendorCheckIn.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug', 'eventId');

	const slug = $derived(params.slug);
	const eventId = $derived(params.eventId);
</script>

<VendorCheckIn
	{eventId}
	parent={[
		{
			label: m.member_vendors_label(),
			href: resolve('/member/groups/[slug]/markets/[eventId]', { slug, eventId })
		}
	]}
/>
