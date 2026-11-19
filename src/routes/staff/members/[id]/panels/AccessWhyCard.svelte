<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import WhyCanAct from '#lib/components/access/WhyCanAct.svelte';
	import { getPersonAccessWhy } from '#lib/remote/why-can-act.remote.js';
	import { errorMessage } from '#lib/error-message.js';
	import { Latest } from '#lib/latest.svelte.js';

	/**
	 * Why this person can act (#2994): positions, committee seats, shift roles.
	 * Its own component so the Account panel keeps one load-bearing query. The
	 * only place the capability lists show (#3241).
	 */
	let { id }: { id: string } = $props();

	const why = new Latest(() => getPersonAccessWhy(id));
	const loaded = $derived(why.current ?? (await getPersonAccessWhy(id).catch(() => undefined)));
</script>

{#if loaded}
	<WhyCanAct why={loaded} showPermissions />
{:else if why.error}
	<Alert type="warning" reset={() => void getPersonAccessWhy(id).refresh()}>
		{m.ui_load_failed_body({ error: errorMessage(why.error.e) })}
	</Alert>
{/if}
