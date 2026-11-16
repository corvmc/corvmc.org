<script lang="ts">
	import CommitteeRecord from '#lib/components/groups/CommitteeRecord.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');
	const id = $derived(params.id);
</script>

{#key id}
	<CommitteeRecord {id} />
{/key}
