<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import StatGrid from '#lib/components/ui/StatGrid.svelte';
	import { getStaffUserTotals } from '#lib/remote/users.remote.js';

	const totals = await getStaffUserTotals();
	const stats = $derived([
		{ title: m.staff_members_user_totals_accounts_title(), value: totals.accounts },
		{ title: m.staff_members_user_totals_sustaining_members_title(), value: totals.sustaining },
		{ title: m.staff_members_user_totals_new_members_title(), value: totals.newMembers }
	]);
</script>

<StatGrid cols={3} class="mb-4">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</StatGrid>
