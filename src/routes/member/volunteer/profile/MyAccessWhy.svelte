<script lang="ts">
	import WhyCanAct from '#lib/components/access/WhyCanAct.svelte';
	import { getMyAccessWhy } from '#lib/remote/why-can-act.remote.js';
	import { Latest } from '#lib/latest.svelte.js';

	/**
	 * What the member's positions, committee seats and shift roles let them do
	 * (#2994). Its own component so the profile page keeps one load-bearing query.
	 * A member with nothing beyond member access sees no card for it.
	 */
	const why = new Latest(() => getMyAccessWhy());
	const loaded = $derived(why.current ?? (await getMyAccessWhy().catch(() => undefined)));
</script>

{#if loaded && (loaded.positions.length || loaded.departments.length || loaded.shiftRoles.length)}
	<WhyCanAct why={loaded} />
{/if}
