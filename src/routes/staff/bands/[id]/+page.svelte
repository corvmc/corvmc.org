<script lang="ts">
	import BandRecord from '#lib/components/groups/BandRecord.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');
	const id = $derived(params.id);
</script>

{#key id}
	<BandRecord {id} />
{/key}
