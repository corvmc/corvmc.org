<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import ItemList from '#lib/components/inventory/ItemList.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import StaffViews from '../StaffViews.svelte';
	import { gearViews } from './views';

	const caps = $derived((await getStaffLayout()).capabilities);
</script>

<PageHeader title={m.staff_gear_title()}>
	<StaffViews views={gearViews} active="items" />
	{#if hasCapability(caps, 'settings.read')}
		<Button variant="ghost" size="sm" href={resolve('staff/inventory/settings')}>
			{m.staff_gear_settings_label()}
		</Button>
	{/if}
</PageHeader>
<ItemList section="gear" />
