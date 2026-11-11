<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { IconCheck, IconX } from '@tabler/icons-svelte';
	import { formatDateTime } from '#lib/utils/format.js';
	import {
		marketVendorStatuses,
		marketVendorStatusLabels,
		type MarketVendorStatus
	} from '#lib/config.js';
	import PreviousMarketNote from '#lib/components/market/PreviousMarketNote.svelte';
	import { decideVendorForm, getCommitteeMarketVendors } from '#lib/remote/market.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug', 'eventId');

	/**
	 * The owning committee's half of a market day: accept or decline (#1503).
	 * Setup, seating changes and withdrawals stay on the staff page, and so do
	 * the vendors' contact details; the decision message reaches the vendor on
	 * their inbox thread either way.
	 */
	const decideFields = decideVendorForm.fields;

	const slug = $derived(params.slug);
	const eventId = $derived(params.eventId);
	const data = $derived(await getCommitteeMarketVendors(eventId));

	type Tab = 'all' | MarketVendorStatus;
	let tab = $state<Tab>('applied');

	const counts = $derived(data.market.counts);
	const tabs = $derived([
		...marketVendorStatuses.map((s) => ({
			key: s,
			label: marketVendorStatusLabels[s],
			badge: counts[s]
		})),
		{ key: 'all', label: m.member_all_label(), badge: data.applications.length }
	]);
	const rows = $derived(
		tab === 'all' ? data.applications : data.applications.filter((a) => a.status === tab)
	);

	const when = $derived(formatDateTime(data.event.startsAt));
	function acceptMessage(business: string) {
		return `Hi ${business} — you're in for ${data.event.title} on ${when}. Reply here with any questions.`;
	}
	function declineMessage(business: string) {
		return `Hi ${business} — thank you for applying to ${data.event.title}. We can't offer you a table this time.`;
	}
</script>

<PageHeader
	title={m.member_groups_slug_markets_event_id_vendors_title({ title: data.event.title })}
	subtitle={when}
>
	<Button
		href={resolve(`member/groups/${slug}/markets/${eventId}/check-in`)}
		variant="ghost"
		size="sm"
	>
		{m.member_groups_slug_markets_event_id_market_day_label()}
	</Button>
</PageHeader>

<PageContent>
	<TabBar {tabs} active={tab} onchange={(key) => (tab = key as Tab)} collapse />

	{#if rows.length === 0}
		<EmptyState
			title={m.member_groups_slug_markets_event_id_no_applications_here_title()}
			description={tab === 'applied'
				? m.member_groups_slug_markets_event_id_nothing_waiting_decision_body()
				: m.member_groups_slug_markets_event_id_applications_arrive_from_body()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.member_status_label()}</span></th>
				<th>{m.member_groups_slug_markets_event_id_vendor_label()}</th>
				<th class="col-support">{m.member_groups_slug_markets_event_id_needs_label()}</th>
				<th>{m.member_groups_slug_markets_event_id_table_label()}</th>
				<th class="w-px"><span class="sr-only">{m.member_actions_label()}</span></th>
			{/snippet}
			{#each rows as row (row.id)}
				<tr>
					<td><StatusBadge status={row.status} /></td>
					<td class="cell-primary">
						<div class="font-medium">{row.businessName}</div>
						<div class="line-clamp-1 text-muted text-sm">{row.offering}</div>
						<PreviousMarketNote previous={row.previous} />
					</td>
					<td class="col-support">
						{row.tablesRequested}
						{row.tablesRequested === 1
							? m.member_groups_slug_markets_event_id_table_2_text()
							: m.member_groups_slug_markets_event_id_tables_text()}{row.needsPower
							? m.member_groups_slug_markets_event_id_power_text()
							: ''}
					</td>
					<td>{row.tableLabel ?? '—'}</td>
					<td>
						<div class="flex w-max justify-end gap-1">
							{#if row.status === 'applied' || row.status === 'declined'}
								<Action
									action={decideVendorForm.for(`accept-${row.id}`)}
									label={m.member_accept_label()}
									iconOnly
									modalTitle={m.member_groups_slug_markets_event_id_accept_title({
										businessName: row.businessName
									})}
									successToast={m.member_groups_slug_markets_event_id_accepted_vendor_told_toast()}
									variant="ghost"
									size="sm"
								>
									{#snippet icon()}<IconCheck size={16} />{/snippet}
									{#snippet form()}
										<input {...decideFields.vendorId.as('hidden', row.id)} />
										<input {...decideFields.decision.as('hidden', 'accepted')} />
										<FormField
											field={decideFields.tableLabel}
											label={m.member_groups_slug_markets_event_id_table_label()}
											value=""
										/>
										<FormField
											field={decideFields.message}
											type="textarea"
											label={m.member_groups_slug_markets_event_id_message_vendor_label()}
											description={m.member_groups_slug_markets_event_id_sent_by_email_their_inbo_body()}
											value={acceptMessage(row.businessName)}
										/>
									{/snippet}
								</Action>
							{/if}
							{#if row.status === 'applied' || row.status === 'accepted'}
								<Action
									action={decideVendorForm.for(`decline-${row.id}`)}
									label={m.member_decline_label()}
									iconOnly
									modalTitle={m.member_groups_slug_markets_event_id_decline_title({
										businessName: row.businessName
									})}
									successToast={m.member_groups_slug_markets_event_id_declined_vendor_told_toast()}
									variant="ghost"
									size="sm"
								>
									{#snippet icon()}<IconX size={16} />{/snippet}
									{#snippet form()}
										<input {...decideFields.vendorId.as('hidden', row.id)} />
										<input {...decideFields.decision.as('hidden', 'declined')} />
										<FormField
											field={decideFields.message}
											type="textarea"
											label={m.member_groups_slug_markets_event_id_message_vendor_label()}
											description={m.member_groups_slug_markets_event_id_sent_by_email_their_inbo_body()}
											value={declineMessage(row.businessName)}
										/>
									{/snippet}
								</Action>
							{/if}
						</div>
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
