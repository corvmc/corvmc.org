<script lang="ts">
	import { page } from '$app/state';
	import GroupRecord from './GroupRecord.svelte';

	let { data } = $props();
	const id = $derived(page.params.id!);
</script>

{#key id}
	<GroupRecord kind={data.kind} {id} />
{/key}
