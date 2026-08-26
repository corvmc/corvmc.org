<script lang="ts">
	import TabBar from '$lib/components/shared/TabBar.svelte';
	import { getVolunteerStatusCounts } from '$lib/remote/volunteer.remote';

	/**
	 * The hour-log status tabs and their counts, owning the query behind the badges.
	 *
	 * `getVolunteerStatusCounts` is unparameterized and refreshed by name after every approval, so
	 * it stays out of the page's filter-keyed query — see PendingReviewCard.
	 */
	let {
		view = $bindable('pending'),
		onchange
	}: { view?: string; onchange?: (key: string) => void } = $props();

	const c = $derived(await getVolunteerStatusCounts());
</script>

<TabBar
	class="mb-4"
	collapse
	tabs={[
		{ key: 'pending', label: 'Pending', badge: c.pending },
		{ key: 'approved', label: 'Approved', badge: c.approved },
		{ key: 'rejected', label: 'Returned', badge: c.rejected },
		{ key: 'all', label: 'All', badge: c.all }
	]}
	active={view}
	onchange={(key) => {
		view = key;
		onchange?.(key);
	}}
/>
