<script lang="ts">
	import GroupRecord from './GroupRecord.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	let { data } = $props();
	const id = $derived(params.id);
</script>

{#key id}
	<GroupRecord kind={data.kind} {id} />
{/key}
