<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import ItemList from '#lib/components/inventory/ItemList.svelte';
</script>

<PageHeader title={m.staff_supplies_title()} />
<ItemList section="supplies" />
