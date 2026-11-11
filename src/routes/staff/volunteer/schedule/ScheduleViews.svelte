<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import { resolve } from '$app/paths';

	// Presentation only: each view's remotes carry its guard.
	let { active }: { active: 'orders' | 'recurring' } = $props();

	const tabs = [
		{
			key: 'orders',
			label: m.staff_volunteer_schedule_schedule_views_work_orders_label(),
			href: resolve('staff/volunteer/schedule')
		},
		{
			key: 'recurring',
			label: m.staff_recurring_label(),
			href: resolve('staff/volunteer/schedule/recurring')
		}
	];
</script>

<TabBar {active} {tabs} />
