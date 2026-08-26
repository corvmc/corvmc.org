<script lang="ts">
	import { getAssignableStaff } from '$lib/remote/inbox.remote';

	/**
	 * The "assigned to" filter's `<option>` list, owning its own query.
	 *
	 * Kept out of the page query for the same reason as the channel list: the page's query is
	 * keyed by its filters, and this one is not. #270 made the same move for AssignControl.
	 */
	const staff = $derived(await getAssignableStaff());
</script>

<option value="">Anyone</option>
<option value="mine">Assigned to me</option>
<option value="unassigned">Unassigned</option>
{#each staff as s (s.id)}
	<option value={s.id}>{s.name}</option>
{/each}
