<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import StatGrid from '#lib/components/ui/StatGrid.svelte';
	import { refreshCommunityStats } from '#lib/remote/settings.remote.js';
	import type { CommunityStats } from '#lib/server/db/schema/finance.js';

	// Moved from global Settings (#2763): the stats count members.
	let result = $state<CommunityStats | null>(null);
	let open = $state(false);
</script>

<Action
	label={m.staff_settings_refresh_stats_label()}
	modalTitle={m.staff_members_refresh_stats_title()}
	confirm={m.staff_settings_community_impact_stats_sustaining_members_body()}
	successLabel={m.staff_settings_refreshed_label()}
	successToast={m.staff_settings_community_stats_refreshed_toast()}
	variant="ghost"
	size="sm"
	action={() => refreshCommunityStats()}
	onsuccess={(r) => {
		result = r as CommunityStats;
		open = true;
	}}
/>

<Modal bind:open title={m.staff_members_community_stats_title()}>
	{#if result}
		<StatGrid cols={3}>
			<StatCard
				title={m.staff_settings_sustaining_members_title()}
				value={result.sustainingMemberCount}
			/>
			<StatCard
				title={m.staff_settings_free_hours_month_title()}
				value={result.totalFreeHoursAllocated}
			/>
			<StatCard
				title={m.staff_settings_participation_title()}
				value={`${result.participationPercent}%`}
			/>
		</StatGrid>
	{/if}
</Modal>
