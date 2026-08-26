<script lang="ts">
	import { getVolunteerRoles } from '$lib/remote/volunteer.remote';

	/**
	 * Volunteer role `<option>`s, owning the query behind them.
	 *
	 * `getVolunteerRoles` is unparameterized and the role mutations refresh it by name, so it
	 * cannot be folded into a page query keyed by a filter set or an id — the mutation would have
	 * nothing to name the wrapper with. Same call as CategoryOptions in the equipment tranche.
	 */
	let { activeOnly = false, keepId = null }: { activeOnly?: boolean; keepId?: string | null } =
		$props();

	const all = $derived(await getVolunteerRoles());
	const roles = $derived(activeOnly ? all.filter((r) => r.isActive || r.id === keepId) : all);
</script>

{#each roles as r (r.id)}
	<!-- Archived roles stay listed when the whole set is shown: their logs are still in the
	     table they filter. The suffix is what tells them apart. -->
	<option value={r.id}>{r.name}{activeOnly || r.isActive ? '' : ' (archived)'}</option>
{/each}
