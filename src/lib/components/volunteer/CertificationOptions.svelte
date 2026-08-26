<script lang="ts">
	import { getActiveCertifications } from '$lib/remote/volunteer.remote';

	/**
	 * Active certification `<option>`s, owning the query behind them.
	 *
	 * Unparameterized and refreshed by name from the certification mutations, so it stays out of
	 * the page queries — see RoleOptions.
	 */
	const certifications = $derived(await getActiveCertifications());
</script>

{#each certifications as c (c.id)}
	<option value={c.id}>{c.name}</option>
{/each}
