<script lang="ts">
	// How a confirmed booking gets in (#2120): the door page, not a code. The
	// link is here so the page can be opened before arrival — the back door may
	// have no signal, and the page carries its fallback code with it (#2157).
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';

	let { now = false }: { /** The door window is open. */ now?: boolean } = $props();
</script>

<InfoCard title={m.components_door_check_in_title()}>
	<p class="text-muted">{m.components_door_check_in_scan_text()}</p>
	<Button href={resolve('door')} variant="primary" outline={!now} class="mt-2">
		{m.components_door_check_in_open_label()}
	</Button>
</InfoCard>
