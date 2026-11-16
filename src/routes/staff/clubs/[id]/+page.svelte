<script lang="ts">
	import ClubRecord from '#lib/components/groups/ClubRecord.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');
	const id = $derived(params.id);
</script>

{#key id}
	<ClubRecord {id} />
{/key}
