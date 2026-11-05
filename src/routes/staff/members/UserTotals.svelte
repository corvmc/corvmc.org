<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import { getStaffUserTotals } from '#lib/remote/users.remote.js';

	const totals = await getStaffUserTotals();
	const stats = $derived([
		{ title: m.staff_members_user_totals_accounts(), value: totals.accounts },
		{ title: m.staff_members_user_totals_sustaining_members(), value: totals.sustaining },
		{ title: m.staff_members_user_totals_new_members(), value: totals.newMembers }
	]);
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</div>
