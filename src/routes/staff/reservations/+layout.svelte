<script lang="ts">
	/**
	 * The practice-space list, with the reservation open from it beside it from
	 * `lg` up (#2631). Settings is a page of its own under the same path.
	 */
	import { page } from '$app/state';
	import ListDetailShell from '#lib/components/ui/ListDetailShell.svelte';
	import ReservationList from './ReservationList.svelte';
	import { ReservationFilters, setReservationFilters } from './filters.svelte';

	let { children } = $props();

	// Seeded once from the URL the layout mounted on; the list mirrors it back.
	const filters = new ReservationFilters(page.url.searchParams);
	setReservationFilters(filters);

	const openId = $derived(
		page.route.id === '/staff/reservations/[id]' ? (page.params.id ?? null) : null
	);
	const settings = $derived(page.route.id === '/staff/reservations/settings');
</script>

{#if settings}
	{@render children()}
{:else}
	<ListDetailShell mode="pages" open={!!openId}>
		{#snippet list()}
			<ReservationList {filters} {openId} />
		{/snippet}
		{@render children()}
	</ListDetailShell>
{/if}
