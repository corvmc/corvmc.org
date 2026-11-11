<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import { getVolunteerStatusCounts } from '#lib/remote/volunteer.remote.js';

	/**
	 * The hour-log status tabs and their counts, owning the query behind the badges.
	 *
	 * `getVolunteerStatusCounts` is unparameterized and refreshed by name after every approval, so
	 * it stays out of the page's filter-keyed query.
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
		{ key: 'pending', label: m.staff_pending_label(), badge: c.pending },
		{ key: 'approved', label: m.staff_approved_label(), badge: c.approved },
		{ key: 'rejected', label: m.staff_returned_label(), badge: c.rejected },
		{ key: 'all', label: m.staff_all_label(), badge: c.all }
	]}
	active={view}
	onchange={(key) => {
		view = key;
		onchange?.(key);
	}}
/>
