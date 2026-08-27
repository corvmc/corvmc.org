<script lang="ts">
	import { getEquipmentCategories } from '$lib/remote/inventory.remote';

	/**
	 * The equipment category `<option>` list, loading its own data.
	 *
	 * `getEquipmentCategories` is unparameterized and the category mutations refresh it by name,
	 * so it must not be folded into a page query keyed by an id or a filter set — a category
	 * mutation has neither to refresh with, and the list would sit stale until navigation. #270
	 * hit exactly this with the inbox channel config. Owning the query here instead keeps those
	 * refreshes working and leaves the page holding one query. Kit dedupes a remote query per
	 * request, so several of these on one screen are still one read.
	 */
	let { selected = null }: { selected?: string | null } = $props();
</script>

{#each await getEquipmentCategories() as cat (cat.id)}
	<option value={cat.id} selected={cat.id === selected}>{cat.name}</option>
{/each}
