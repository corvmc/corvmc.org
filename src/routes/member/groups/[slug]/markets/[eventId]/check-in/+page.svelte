<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import VendorCheckIn from '$lib/components/market/VendorCheckIn.svelte';

	const slug = $derived(page.params.slug!);
	const eventId = $derived(page.params.eventId!);
</script>

<VendorCheckIn
	{eventId}
	parent={[
		{
			label: m.member_vendors(),
			href: resolve('/member/groups/[slug]/markets/[eventId]', { slug, eventId })
		}
	]}
/>
