<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
	import VendorFee from './VendorFee.svelte';
	import InviteBackAction from './InviteBackAction.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { Crumb } from '#lib/components/ui/breadcrumbs.js';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { formatDateTime, formatTime } from '#lib/utils/format.js';
	import {
		checkInVendorForm,
		getMarketDayCheckIn,
		markNoShowForm
	} from '#lib/remote/market.remote.js';

	/**
	 * A market day at the door (#1505): mark each booked vendor arrived or a
	 * no-show, see what each still owes, and record whether to ask them back.
	 * Shared by the staff and the owning committee's routes; `getMarketDayCheckIn`
	 * carries no contact detail.
	 */
	let { eventId, parent }: { eventId: string; parent: Crumb[] } = $props();

	const data = $derived(await getMarketDayCheckIn(eventId));
	const arrived = $derived(data.vendors.filter((v) => v.checkedInAt).length);
	const noShows = $derived(data.vendors.filter((v) => v.status === 'no_show').length);
	const booked = $derived(data.vendors.length - noShows);
</script>

<PageHeader
	width="3xl"
	title={m.market_vendor_check_in_market_day_title({ title: data.event.title })}
	subtitle={formatDateTime(data.event.startsAt)}
	{parent}
/>
<PageContent width="3xl">
	<div class="flex flex-wrap gap-6">
		<StatCard
			title={m.market_vendor_check_in_arrived_title()}
			value="{arrived} / {booked}"
			size="sm"
			class="p-4"
		/>
		<StatCard
			title={m.market_vendor_check_in_no_shows_title()}
			value={noShows}
			size="sm"
			class="p-4"
		/>
	</div>

	{#if data.vendors.length === 0}
		<EmptyState
			title={m.market_vendor_check_in_no_vendors_booked_title()}
			description={m.market_vendor_check_in_accepted_vendors_appear_here_check_body()}
		/>
	{/if}

	<div class="space-y-2">
		{#each data.vendors as vendor (vendor.id)}
			<Card>
				<CardBody row padding="sm">
					<div>
						<p class="font-medium">
							{vendor.businessName}
							{#if vendor.tableLabel}<span class="text-muted"
									>{m.market_vendor_check_in_table_text({ tableLabel: vendor.tableLabel })}</span
								>{/if}
						</p>
						<p class="text-muted text-sm">
							{vendor.tablesRequested}
							{vendor.tablesRequested === 1
								? m.market_vendor_check_in_table_2_text()
								: m.market_vendor_check_in_tables_text()}{vendor.needsPower
								? m.market_vendor_check_in_needs_power_text()
								: ''}{vendor.bringsOwnTable
								? m.market_vendor_check_in_own_table_text()
								: ''}{vendor.bringsTent ? m.market_vendor_check_in_tent_text() : ''}
						</p>
						{#if vendor.fee.state !== 'none'}
							<p class="text-sm">
								<VendorFee fee={vendor.fee} />
								{#if vendor.fee.state === 'due' && vendor.status === 'accepted'}
									<a
										class="ml-2 link"
										href={resolve(`market/pay/${vendor.id}`)}
										target="_blank"
										rel="noopener">{m.market_vendor_check_in_take_payment_text()}</a
									>
								{/if}
							</p>
						{/if}
						{#if vendor.inviteBack !== null}
							<p class="text-sm">
								{vendor.inviteBack
									? m.market_invite_back_text()
									: m.market_do_not_invite_back_text()}{vendor.inviteBackNote
									? `: “${vendor.inviteBackNote}”`
									: ''}
							</p>
						{/if}
					</div>

					<div class="flex flex-wrap items-center gap-2">
						{#if vendor.status === 'no_show'}
							<StatusBadge status="no_show" />
							<Form
								remote={markNoShowForm.for(`undo-${vendor.id}`)}
								successToast={m.market_vendor_check_in_restored_toast()}
								class="inline"
							>
								<input
									{...markNoShowForm
										.for(`undo-${vendor.id}`)
										.fields.vendorId.as('hidden', vendor.id)}
								/>
								<input
									{...markNoShowForm.for(`undo-${vendor.id}`).fields.noShow.as('hidden', 'no')}
								/>
								<SubmitButton
									label={m.market_vendor_check_in_undo_label()}
									variant="ghost"
									size="sm"
								/>
							</Form>
						{:else if vendor.checkedInAt}
							<StatusBadge status="checked_in" />
							<span class="text-muted text-sm">{formatTime(vendor.checkedInAt)}</span>
							<Form
								remote={checkInVendorForm.for(`out-${vendor.id}`)}
								successToast={m.market_vendor_check_in_check_undone_toast()}
								class="inline"
							>
								<input
									{...checkInVendorForm
										.for(`out-${vendor.id}`)
										.fields.vendorId.as('hidden', vendor.id)}
								/>
								<input
									{...checkInVendorForm.for(`out-${vendor.id}`).fields.arrived.as('hidden', 'no')}
								/>
								<SubmitButton
									label={m.market_vendor_check_in_undo_label()}
									variant="ghost"
									size="sm"
								/>
							</Form>
						{:else}
							<!-- 44px, as at the ticket door: tapped many times in a row, one-handed. -->
							<Form
								remote={checkInVendorForm.for(`in-${vendor.id}`)}
								successToast={m.market_vendor_check_in_checked_toast()}
								class="inline"
							>
								<input
									{...checkInVendorForm
										.for(`in-${vendor.id}`)
										.fields.vendorId.as('hidden', vendor.id)}
								/>
								<input
									{...checkInVendorForm.for(`in-${vendor.id}`).fields.arrived.as('hidden', 'yes')}
								/>
								<SubmitButton
									label={m.market_vendor_check_in_arrived_label()}
									variant="primary"
									class="min-h-11"
								/>
							</Form>
							<Form
								remote={markNoShowForm.for(`ns-${vendor.id}`)}
								successToast={m.market_vendor_check_in_marked_no_show_toast()}
								class="inline"
							>
								<input
									{...markNoShowForm.for(`ns-${vendor.id}`).fields.vendorId.as('hidden', vendor.id)}
								/>
								<input
									{...markNoShowForm.for(`ns-${vendor.id}`).fields.noShow.as('hidden', 'yes')}
								/>
								<SubmitButton
									label={m.market_vendor_check_in_no_show_label()}
									variant="ghost"
									size="sm"
								/>
							</Form>
						{/if}

						<InviteBackAction {vendor} />
					</div>
				</CardBody>
			</Card>
		{/each}
	</div>
</PageContent>
