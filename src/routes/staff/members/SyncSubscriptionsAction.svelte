<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import StatGrid from '#lib/components/ui/StatGrid.svelte';
	import { syncSubscriptions } from '#lib/remote/settings.remote.js';
	import type { SubscriptionSyncSummary } from '#lib/types/subscription-sync.js';

	// Moved from global Settings (#2763): it reconciles members' and bands' records.
	let result = $state<SubscriptionSyncSummary | null>(null);
	let open = $state(false);
</script>

<Action
	label={m.staff_members_sync_subscriptions_label()}
	modalTitle={m.staff_members_sync_subscriptions_title()}
	confirm={m.staff_settings_reconciles_every_member_band_subscription_body()}
	successLabel={m.staff_settings_synced_label()}
	successToast={m.staff_settings_subscriptions_synced_from_stripe_toast()}
	variant="ghost"
	size="sm"
	action={() => syncSubscriptions()}
	onsuccess={(r) => {
		result = r as SubscriptionSyncSummary;
		open = true;
	}}
/>

<Modal bind:open title={m.staff_members_sync_results_title()} maxWidth="max-w-3xl">
	{#if result}
		<StatGrid cols={4}>
			<StatCard title={m.staff_settings_scanned_title()} value={result.totalScanned} />
			<StatCard title={m.staff_settings_users_updated_title()} value={result.usersUpdated} />
			<StatCard title={m.staff_settings_users_cleared_title()} value={result.usersCleared} />
			<StatCard
				title={m.staff_settings_credits_reconciled_title()}
				value={result.creditsReconciled}
			/>
			<StatCard title={m.staff_settings_bands_updated_title()} value={result.bandsUpdated} />
			<StatCard title={m.staff_settings_bands_cleared_title()} value={result.bandsCleared} />
			<StatCard title={m.staff_settings_skipped_title()} value={result.skipped} />
		</StatGrid>

		{#if result.errors.length > 0}
			<Alert type="warning">
				<p class="font-semibold">
					{m.staff_settings_record_s_had_issues_text({ length: result.errors.length })}
				</p>
				<ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm">
					{#each result.errors as err, i (i)}
						<li>
							<Badge variant="ghost">{err.kind}</Badge>
							{err.message}{err.ref ? ` (${err.ref})` : ''}
						</li>
					{/each}
				</ul>
			</Alert>
		{/if}
	{/if}
</Modal>
