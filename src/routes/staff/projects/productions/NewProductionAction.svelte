<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Button from '$lib/components/ui/Button.svelte';
	import NewProductionModal from './NewProductionModal.svelte';
	import { hasCapability } from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';

	// Its own component so the page keeps one query of its own, as on the
	// Calendar's Create Listing. The staff layout has already fetched this.
	const caps = $derived((await getStaffLayout()).capabilities);
	let open = $state(false);
</script>

{#if hasCapability(caps, 'production.create')}
	<Button variant="default" size="sm" onclick={() => (open = true)}
		>{m.staff_new_production()}</Button
	>
	<NewProductionModal bind:open />
{/if}
