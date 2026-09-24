<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { IconCheck, IconX } from '@tabler/icons-svelte';
	import { formatDateTime } from '$lib/utils/format';
	import {
		marketVendorStatuses,
		marketVendorStatusLabels,
		type MarketVendorStatus
	} from '$lib/config';
	import PreviousMarketNote from '$lib/components/market/PreviousMarketNote.svelte';
	import { decideVendorForm, getCommitteeMarketVendors } from '$lib/remote/market.remote';

	/**
	 * The owning committee's half of a market day: accept or decline (#1503).
	 * Setup, seating changes and withdrawals stay on the staff page, and so do
	 * the vendors' contact details; the decision message reaches the vendor on
	 * their inbox thread either way.
	 */
	const decideFields = decideVendorForm.fields;

	const slug = $derived(page.params.slug!);
	const eventId = $derived(page.params.eventId!);
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
		{ key: 'all', label: 'All', badge: data.applications.length }
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
	title="Vendors: {data.event.title}"
	subtitle={when}
	backHref={resolve(`/member/groups/${slug}?tab=projects`)}
>
	<Button
		href={resolve(`/member/groups/${slug}/markets/${eventId}/check-in`)}
		variant="ghost"
		size="sm"
	>
		Market day
	</Button>
</PageHeader>

<PageContent>
	<TabBar {tabs} active={tab} onchange={(key) => (tab = key as Tab)} collapse />

	{#if rows.length === 0}
		<EmptyState
			title="No applications here"
			description={tab === 'applied'
				? 'Nothing waiting on a decision.'
				: 'Applications arrive from the public event page.'}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Vendor</th>
				<th class="col-support">Needs</th>
				<th>Table</th>
				<th class="w-px"><span class="sr-only">Actions</span></th>
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
						{row.tablesRequested === 1 ? 'table' : 'tables'}{row.needsPower ? ', power' : ''}
					</td>
					<td>{row.tableLabel ?? '—'}</td>
					<td>
						<div class="flex w-max justify-end gap-1">
							{#if row.status === 'applied' || row.status === 'declined'}
								<Action
									action={decideVendorForm.for(`accept-${row.id}`)}
									label="Accept"
									iconOnly
									modalTitle="Accept {row.businessName}"
									successToast="Accepted — vendor told"
									variant="ghost"
									size="sm"
								>
									{#snippet icon()}<IconCheck size={16} />{/snippet}
									{#snippet form()}
										<input {...decideFields.vendorId.as('hidden', row.id)} />
										<input {...decideFields.decision.as('hidden', 'accepted')} />
										<FormField field={decideFields.tableLabel} label="Table" value="" />
										<FormField
											field={decideFields.message}
											type="textarea"
											label="Message to the vendor"
											description="Sent by email on their inbox thread."
											value={acceptMessage(row.businessName)}
										/>
									{/snippet}
								</Action>
							{/if}
							{#if row.status === 'applied' || row.status === 'accepted'}
								<Action
									action={decideVendorForm.for(`decline-${row.id}`)}
									label="Decline"
									iconOnly
									modalTitle="Decline {row.businessName}"
									successToast="Declined — vendor told"
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
											label="Message to the vendor"
											description="Sent by email on their inbox thread."
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
