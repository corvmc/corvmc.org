<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import MoneyField from '#lib/components/ui/Form/MoneyField.svelte';
	import { IconCheck, IconX, IconArrowBackUp, IconTable } from '@tabler/icons-svelte';
	import { formatCents, formatDateTime, toLocalDateTime } from '#lib/utils/format.js';
	import {
		marketVendorStatuses,
		marketVendorStatusLabels,
		type MarketVendorStatus
	} from '#lib/config.js';
	import PreviousMarketNote from '#lib/components/market/PreviousMarketNote.svelte';
	import {
		decideVendorForm,
		getStaffMarketVendors,
		openMarketDayForm,
		setTableLabelForm,
		withdrawVendorForm
	} from '#lib/remote/market.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	/**
	 * A market day's vendor applications. docs/specs/shipped/market-vendors-spec.md.
	 *
	 * Accept and decline each send the vendor a message on their inbox thread,
	 * which is why both modals ask for one: the decision and the telling are one
	 * act, and a decision nobody was told about is how a vendor turns up anyway.
	 */
	const setupFields = openMarketDayForm.fields;
	const decideFields = decideVendorForm.fields;
	const tableFields = setTableLabelForm.fields;
	const withdrawFields = withdrawVendorForm.fields;

	const eventId = $derived(params.id);
	const data = $derived(await getStaffMarketVendors(eventId));

	type Tab = 'all' | MarketVendorStatus;
	let tab = $state<Tab>('applied');

	const counts = $derived(data.market?.counts);
	const tabs = $derived([
		...marketVendorStatuses.map((s) => ({
			key: s,
			label: marketVendorStatusLabels[s],
			badge: counts?.[s] ?? 0
		})),
		{ key: 'all', label: m.staff_all_label(), badge: data.applications.length }
	]);
	const rows = $derived(
		tab === 'all' ? data.applications : data.applications.filter((a) => a.status === tab)
	);
	const tablesAssigned = $derived(
		data.applications
			.filter((a) => a.status === 'accepted')
			.reduce((n, a) => n + a.tablesRequested, 0)
	);

	const when = $derived(formatDateTime(data.event.startsAt));
	function acceptMessage(business: string, table?: string | null) {
		return `Hi ${business} — you're in for ${data.event.title} on ${when}.${
			table ? ` Your table is ${table}.` : ''
		} Reply here with any questions.`;
	}
	function declineMessage(business: string) {
		return `Hi ${business} — thank you for applying to ${data.event.title}. We can't offer you a table this time.`;
	}
</script>

{#snippet feeFields(
	market: {
		tableFeeCents: number;
		slidingScale: boolean;
		slidingScaleFloorCents: number;
	} | null
)}
	<MoneyField
		field={setupFields.tableFeeCents}
		label={m.staff_events_id_vendors_table_fee_label()}
		description={m.staff_events_id_vendors_per_table_charged_when_vendor_body()}
		value={market?.tableFeeCents || undefined}
	/>
	<FormField
		field={setupFields.slidingScale}
		type="checkbox"
		label={m.staff_events_id_vendors_sliding_scale_label()}
		description={m.staff_events_id_vendors_let_vendors_pay_what_they_body()}
		value={market?.slidingScale ?? false}
	/>
	<MoneyField
		field={setupFields.slidingScaleFloorCents}
		label={m.staff_events_id_vendors_sliding_scale_floor_label()}
		description={m.staff_events_id_vendors_per_table_only_used_with_body()}
		value={market?.slidingScaleFloorCents || undefined}
	/>
{/snippet}

<PageHeader
	title={m.staff_events_id_vendors_vendors_title({ title: data.event.title })}
	crumb="Vendors"
	parent={{ label: data.event.title, href: resolve('/staff/events/[id]', { id: data.event.id }) }}
>
	{#if data.market}
		<Button
			href={resolve(`staff/events/${data.event.id}/vendors/check-in`)}
			variant="ghost"
			size="sm"
		>
			{m.staff_events_id_vendors_market_day_label()}
		</Button>
		<Action
			action={openMarketDayForm}
			label={m.staff_events_id_vendors_edit_setup_label()}
			modalTitle={m.staff_events_id_vendors_market_setup_title()}
			successToast={m.staff_saved_toast()}
			variant="ghost"
			size="sm"
		>
			{#snippet form()}
				<input {...setupFields.eventId.as('hidden', data.event.id)} />
				<FormField
					field={setupFields.applicationsCloseAt}
					type="datetime-local"
					label={m.staff_events_id_vendors_applications_close_label()}
					description={m.staff_events_id_vendors_leave_blank_take_applications_until_body()}
					value={data.market?.applicationsCloseAt
						? toLocalDateTime(data.market.applicationsCloseAt)
						: undefined}
				/>
				<FormField
					field={setupFields.tableCount}
					type="number"
					label={m.staff_events_id_vendors_tables_available_label()}
					value={data.market?.tableCount ?? undefined}
				/>
				{@render feeFields(data.market)}
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	{#if !data.market}
		<Card>
			<CardBody>
				<h2 class="font-semibold">{m.staff_events_id_vendors_take_vendor_applications_title()}</h2>
				<p class="text-muted">
					{m.staff_events_id_vendors_opening_listing_as_market_puts_text()}
				</p>
				<Form
					remote={openMarketDayForm}
					successToast={m.staff_events_id_vendors_open_applications_toast()}
					class="space-y-2"
				>
					<input {...setupFields.eventId.as('hidden', data.event.id)} />
					<div class="grid gap-4 sm:grid-cols-2">
						<FormField
							field={setupFields.applicationsCloseAt}
							type="datetime-local"
							label={m.staff_events_id_vendors_applications_close_label()}
							description={m.staff_events_id_vendors_blank_means_open_until_market_body()}
						/>
						<FormField
							field={setupFields.tableCount}
							type="number"
							label={m.staff_events_id_vendors_tables_available_label()}
						/>
					</div>
					{@render feeFields(null)}
					<SubmitButton label={m.staff_events_id_vendors_open_applications_label()} />
				</Form>
			</CardBody>
		</Card>
	{:else}
		<div class="flex flex-wrap gap-4">
			<StatCard
				title={m.staff_events_id_vendors_review_title()}
				value={counts?.applied ?? 0}
				size="sm"
				class="p-4"
			/>
			<StatCard
				title={m.staff_events_id_vendors_accepted_title()}
				value={counts?.accepted ?? 0}
				size="sm"
				class="p-4"
			/>
			<StatCard
				title={m.staff_events_id_vendors_tables_taken_title()}
				value={data.market.tableCount
					? `${tablesAssigned} / ${data.market.tableCount}`
					: tablesAssigned}
				size="sm"
				class="p-4"
			/>
			<StatCard
				title={m.staff_events_id_vendors_applications_title()}
				value={data.market.accepting
					? data.market.applicationsCloseAt
						? `Open until ${formatDateTime(data.market.applicationsCloseAt)}`
						: 'Open'
					: 'Closed'}
				size="sm"
				class="p-4"
			/>
		</div>

		<TabBar {tabs} active={tab} onchange={(key) => (tab = key as Tab)} collapse />

		{#if rows.length === 0}
			<EmptyState
				title={m.staff_events_id_vendors_no_applications_here_title()}
				description={tab === 'applied'
					? m.staff_events_id_vendors_nothing_waiting_decision_body()
					: m.staff_events_id_vendors_applications_arrive_from_public_even_body()}
			/>
		{:else}
			<p class="text-muted text-sm">
				{m.staff_events_id_vendors_applications_2_text({
					length: rows.length,
					length2: data.applications.length
				})}
			</p>
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_events_id_vendors_vendor_label()}</th>
					<th class="col-support">{m.staff_events_id_vendors_needs_label()}</th>
					<th class="col-support">{m.staff_events_id_vendors_contact_label()}</th>
					<th>{m.staff_events_id_vendors_table_label()}</th>
					<th class="col-support">{m.staff_events_id_vendors_fee_label()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
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
								? m.staff_events_id_vendors_table_3_text()
								: m.staff_events_id_vendors_tables_text()}{row.needsPower
								? m.staff_events_id_vendors_power_text()
								: ''}
						</td>
						<td class="col-support">
							{#if row.threadId}
								<a class="link" href={resolve(`staff/inbox/${row.threadId}`)}>
									{row.contactName ?? row.contactEmail}
								</a>
							{:else}
								<span class="text-muted">{row.contactName ?? '—'}</span>
							{/if}
						</td>
						<td>{row.tableLabel ?? '—'}</td>
						<td class="col-support">
							{#if row.feeCents === 0}
								<span class="text-muted">—</span>
							{:else if row.refundedAt}
								{m.staff_events_id_vendors_refunded_text()}
							{:else if row.paidAt}
								{m.staff_events_id_vendors_paid_text({
									formatCents: formatCents(row.paidCents ?? 0)
								})}
							{:else}
								{m.staff_events_id_vendors_due_text({ formatCents: formatCents(row.feeCents) })}
							{/if}
						</td>
						<td>
							<div class="flex w-max justify-end gap-1">
								{#if row.status === 'applied' || row.status === 'declined'}
									<Action
										action={decideVendorForm.for(`accept-${row.id}`)}
										label={m.staff_events_id_vendors_accept_label()}
										iconOnly
										modalTitle={m.staff_events_id_vendors_accept_2_title({
											businessName: row.businessName
										})}
										successToast={m.staff_events_id_vendors_accepted_vendor_told_toast()}
										variant="ghost"
										size="sm"
									>
										{#snippet icon()}<IconCheck size={16} />{/snippet}
										{#snippet form()}
											<input {...decideFields.vendorId.as('hidden', row.id)} />
											<input {...decideFields.decision.as('hidden', 'accepted')} />
											<FormField
												field={decideFields.tableLabel}
												label={m.staff_events_id_vendors_table_label()}
												value=""
											/>
											<FormField
												field={decideFields.message}
												type="textarea"
												label={m.staff_events_id_vendors_message_vendor_label()}
												description={data.market?.tableFeeCents
													? m.staff_events_id_vendors_sent_by_email_their_inbox_body()
													: m.staff_events_id_vendors_sent_by_email_their_inbox_2_body()}
												value={acceptMessage(row.businessName)}
											/>
										{/snippet}
									</Action>
								{/if}
								{#if row.status === 'accepted'}
									<Action
										action={setTableLabelForm.for(row.id)}
										label={m.staff_events_id_vendors_move_table_label()}
										iconOnly
										modalTitle={m.staff_events_id_vendors_table_2_title({
											businessName: row.businessName
										})}
										successToast={m.staff_events_id_vendors_table_saved_toast()}
										variant="ghost"
										size="sm"
									>
										{#snippet icon()}<IconTable size={16} />{/snippet}
										{#snippet form()}
											<input {...tableFields.vendorId.as('hidden', row.id)} />
											<FormField
												field={tableFields.tableLabel}
												label={m.staff_events_id_vendors_table_label()}
												value={row.tableLabel ?? ''}
											/>
										{/snippet}
									</Action>
								{/if}
								{#if row.status === 'applied' || row.status === 'accepted'}
									<Action
										action={decideVendorForm.for(`decline-${row.id}`)}
										label={m.staff_events_id_vendors_decline_label()}
										iconOnly
										modalTitle={m.staff_events_id_vendors_decline_2_title({
											businessName: row.businessName
										})}
										successToast={m.staff_events_id_vendors_declined_vendor_told_toast()}
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
												label={m.staff_events_id_vendors_message_vendor_label()}
												description={m.staff_events_id_vendors_sent_by_email_their_inbox_2_body()}
												value={declineMessage(row.businessName)}
											/>
										{/snippet}
									</Action>
								{/if}
								{#if row.status !== 'withdrawn' && row.status !== 'no_show'}
									<Action
										action={withdrawVendorForm.for(row.id)}
										label={m.staff_events_id_vendors_mark_withdrawn_label()}
										iconOnly
										modalTitle={m.staff_events_id_vendors_pulled_out_title({
											businessName: row.businessName
										})}
										successToast={m.staff_events_id_vendors_marked_withdrawn_toast()}
										variant="ghost"
										size="sm"
									>
										{#snippet icon()}<IconArrowBackUp size={16} />{/snippet}
										{#snippet form()}
											<input {...withdrawFields.vendorId.as('hidden', row.id)} />
											<p>
												{m.staff_events_id_vendors_when_vendor_says_they_can_text()}
											</p>
										{/snippet}
									</Action>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/if}
</PageContent>
