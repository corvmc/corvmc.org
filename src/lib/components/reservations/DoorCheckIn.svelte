<script lang="ts">
	// How a confirmed booking gets in (#2120): the door page, not a code. The
	// link is here so the page can be opened before arrival — the back door may
	// have no signal, and the page carries its fallback code with it (#2157).
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';

	let { now = false }: { /** The door window is open. */ now?: boolean } = $props();
</script>

<InfoCard title="Check in at the back door">
	<p class="text-muted">Scan the code on the door, or open the page before you get there.</p>
	<Button href={resolve('/door')} variant="primary" outline={!now} class="mt-2">
		Open door page
	</Button>
</InfoCard>
