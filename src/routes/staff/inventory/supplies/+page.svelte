<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import ItemList from '#lib/components/inventory/ItemList.svelte';
	import StaffViews from '../../StaffViews.svelte';
	import { gearViews } from '../views';
</script>

<PageHeader title={m.staff_gear_title()} documentTitle={m.staff_supplies_title()}>
	<StaffViews views={gearViews} active="supplies" />
</PageHeader>
<ItemList section="supplies" />
