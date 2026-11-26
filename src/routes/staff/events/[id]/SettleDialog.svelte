<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Modal from '#lib/components/ui/Modal.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import MoneyField from '#lib/components/ui/Form/MoneyField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import {
		recordPayouts,
		recordStaffCount,
		undoActPayout
	} from '#lib/remote/productions.remote.js';
	import { formatCents, formatDateTimeShort } from '#lib/utils/format.js';
	import { isTerminalProduction } from '#lib/production/status.js';
	import type { ProductionStatus } from '#lib/server/db/schema/production.js';
	import type { ActSettlement, Settlement } from '#lib/server/production/settlement-service.js';
	import { settleReadOnly } from './tabs';

	/**
	 * The event's settlement in one dialog (#3273): the night's net, the staff
	 * count of the till and each act's payout. Editing is for a show with acts
	 * still unpaid; once every act is paid it shows the same figures, and a
	 * `finance.refund` holder can undo one payout.
	 */
	let {
		open = $bindable(false),
		eventId,
		settlement,
		canCount,
		canPayout
	}: {
		open?: boolean;
		eventId: string;
		settlement: Settlement;
		canCount: boolean;
		canPayout: boolean;
	} = $props();

	const count = recordStaffCount.for('settle');
	const payouts = recordPayouts.for('settle');

	const readonly = $derived(settleReadOnly(settlement));
	const locked = $derived(isTerminalProduction(settlement.status as ProductionStatus));
	const acts = $derived(settlement.acts);
	const unpaid = $derived(acts.filter((a) => a.paidCents === null));
	const counts = $derived(settlement.doorCounts);
	const handoffTotal = $derived(counts?.handoffs.reduce((t, h) => t + h.cashCents, 0) ?? 0);
	const takings = $derived(settlement.doorTakings);
	// Warns, never refuses: a guest list or a re-entry can make the counts differ (#2801).
	const countGap = $derived(
		settlement.door?.count != null ? settlement.door.count - takings.checkedIn : 0
	);

	let amounts = $state<Record<string, number | null>>({});
	let donated = $state<Record<string, boolean>>({});
	let undoing = $state<string | null>(null);

	function amountOf(act: ActSettlement): number {
		if (donated[act.slotId]) return 0;
		return act.slotId in amounts ? (amounts[act.slotId] ?? 0) : act.suggestedPayoutCents;
	}

	const total = $derived(
		acts.reduce((t, a) => t + (a.paidCents ?? (readonly ? 0 : amountOf(a))), 0)
	);
	// The deal's own net, while a terminal show still has unpaid acts to leave out.
	const net = $derived(
		readonly && unpaid.length > 0
			? settlement.netCents
			: settlement.collectiveRevenueCents -
					settlement.expensesCents -
					(total - settlement.actsPoolCents)
	);

	function dealText(act: ActSettlement): string {
		if (act.contributed)
			return m.staff_events_id_settle_dialog_donated_text({ amount: formatCents(0) });
		const parts: string[] = [];
		if (act.guaranteeCents) parts.push(formatCents(act.guaranteeCents));
		if (act.guaranteeCents && act.percentageBps) {
			parts.push(
				act.versus
					? m.staff_events_id_settle_dialog_deal_versus_text()
					: m.staff_events_id_settle_dialog_deal_plus_text()
			);
		}
		if (act.percentageBps) {
			const percent = (act.percentageBps / 100).toFixed(0);
			parts.push(
				act.againstNet
					? m.staff_events_id_settle_dialog_deal_net_text({ percent })
					: m.staff_events_id_settle_dialog_deal_pool_text({ percent })
			);
		}
		return parts.join(' ');
	}
</script>

<Modal
	bind:open
	title={readonly
		? m.staff_events_id_settle_dialog_view_title()
		: m.staff_events_id_settle_dialog_title_title()}
	maxWidth="max-w-3xl"
>
	<div class="flex flex-col gap-4">
		{#if locked}
			<Alert type="info">{m.staff_events_id_settle_dialog_read_only_body()}</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<div>
				<p class="text-muted">{m.staff_events_id_settle_dialog_pool_text()}</p>
				<p class="text-lg font-medium">{formatCents(settlement.actsPoolCents)}</p>
			</div>
			<div>
				<p class="text-muted">{m.staff_events_id_settle_dialog_costs_text()}</p>
				<p class="text-lg font-medium">{formatCents(settlement.expensesCents)}</p>
			</div>
			<div>
				<p class="text-muted">{m.staff_events_id_settle_dialog_net_text()}</p>
				<p
					class="text-lg font-medium"
					class:text-error={net < 0}
					data-testid="settle-net"
					data-cents={net}
				>
					{formatCents(net)}
				</p>
			</div>
		</div>

		<InfoCard title={m.staff_events_id_settle_dialog_door_title()}>
			{#if !readonly && canCount}
				<Form
					remote={count}
					successToast={m.staff_events_id_settle_dialog_count_toast()}
					class="flex flex-col gap-3"
				>
					<input {...count.fields.id.as('hidden', settlement.productionId)} />
					<input {...count.fields.eventId.as('hidden', eventId)} />
					<div class="grid gap-3 sm:grid-cols-3">
						<MoneyField
							field={count.fields.doorCashCents}
							label={m.staff_events_id_settle_dialog_cash_label()}
							value={counts?.staff?.cashCents ?? null}
						/>
						<FormField
							field={count.fields.doorCount}
							type="number"
							label={m.staff_events_id_settle_dialog_headcount_label()}
							description={m.staff_events_id_settle_dialog_headcount_body({
								checkedIn: takings.checkedIn,
								card: takings.card.tickets,
								cash: takings.cash.tickets,
								free: takings.free.tickets
							})}
							value={settlement.door?.count ?? undefined}
							min={0}
						/>
						<FormField
							field={count.fields.splitActsPercent}
							type="number"
							label={m.staff_events_id_settle_dialog_split_label()}
							description={m.staff_events_id_settle_dialog_split_body()}
							value={settlement.door?.overridden ? settlement.door.actsPercent : undefined}
							min={0}
							max={100}
						/>
					</div>
					<div>
						<SubmitButton label={m.staff_events_id_settle_dialog_count_label()} size="sm" />
					</div>
				</Form>
			{:else if settlement.door}
				<p>
					{m.staff_events_id_settle_dialog_cash_counted_text({
						amount: formatCents(settlement.door.cashCents)
					})}
				</p>
			{/if}

			{#if counts && counts.handoffs.length > 0}
				<ul class="mt-3 text-sm" data-testid="till-handoffs">
					{#each counts.handoffs as handoff (handoff.id)}
						<li>
							{m.staff_events_id_settle_dialog_handoff_text({
								amount: formatCents(handoff.cashCents),
								name: handoff.byName ?? '',
								at: formatDateTimeShort(handoff.at)
							})}
						</li>
					{/each}
				</ul>
			{/if}

			{#if settlement.door}
				{#if settlement.door.gapCents !== 0}
					<div class="mt-3" data-testid="door-cash-gap">
						<Alert type="warning">
							{settlement.door.gapCents > 0
								? m.staff_events_id_settle_dialog_cash_over_body({
										amount: formatCents(settlement.door.gapCents)
									})
								: m.staff_events_id_settle_dialog_cash_short_body({
										amount: formatCents(-settlement.door.gapCents)
									})}
						</Alert>
					</div>
				{/if}
				{#if settlement.door.unrecordedCents > 0}
					<p class="mt-3 text-muted">
						{m.staff_events_id_settle_dialog_door_split_text({
							unrecorded: formatCents(settlement.door.unrecordedCents),
							actsPercent: settlement.door.actsPercent,
							collectivePercent: 100 - settlement.door.actsPercent,
							acts: formatCents(settlement.door.actsCents),
							collective: formatCents(settlement.door.collectiveCents)
						})}
					</p>
				{/if}
				{#if countGap !== 0}
					<div class="mt-3" data-testid="door-count-gap">
						<Alert type="warning">
							{m.staff_events_id_settle_dialog_headcount_off_body({ count: Math.abs(countGap) })}
						</Alert>
					</div>
				{/if}
				{#if counts?.check === 'mismatch' && counts.staff}
					<Alert type="warning" class="mt-3">
						{m.staff_events_id_settle_dialog_counts_differ_body({
							amount: formatCents(Math.abs(counts.staff.cashCents - handoffTotal))
						})}
					</Alert>
				{:else if counts?.check === 'single'}
					<p class="mt-3 text-muted">{m.staff_events_id_settle_dialog_counted_once_text()}</p>
				{/if}
				{#if counts?.oneCounter}
					<div class="mt-3" data-testid="door-one-counter">
						<Alert type="warning">{m.staff_events_id_settle_dialog_one_counter_body()}</Alert>
					</div>
				{/if}
			{:else}
				<p class="mt-3 text-muted">{m.staff_events_id_settle_dialog_no_count_text()}</p>
			{/if}
		</InfoCard>

		<InfoCard title={m.staff_events_id_settle_dialog_payouts_title()}>
			{#if acts.length === 0}
				<p class="text-fg-2">{m.staff_events_id_settle_dialog_no_bands_text()}</p>
			{:else}
				{@const listed = readonly ? acts : acts.filter((a) => a.paidCents !== null)}
				{#if listed.length > 0}
					<Table>
						{#snippet head()}
							<th>{m.staff_band_label()}</th>
							<th>{m.staff_events_id_settle_dialog_deal_label()}</th>
							<th class="text-right">{m.staff_paid_label()}</th>
						{/snippet}
						{#each listed as act (act.slotId)}
							<tr>
								<td>{act.actName ?? m.staff_not_bill_text()}</td>
								<td class="text-sm text-fg-2">{dealText(act)}</td>
								<td class="text-right">
									{#if act.paidCents === null}
										<span class="text-sm text-fg-2"
											>{m.staff_events_id_settle_dialog_unpaid_text()}</span
										>
									{:else if undoing === act.slotId}
										{@const undo = undoActPayout.for(act.slotId)}
										<!-- Confirmed in this same modal: a dialog opened from inside one
										     cannot be clicked (#876). -->
										<Form
											remote={undo}
											successToast={m.staff_events_id_settle_dialog_undone_toast()}
											onsuccess={() => (undoing = null)}
											class="flex flex-col items-end gap-2"
										>
											<input {...undo.fields.eventId.as('hidden', eventId)} />
											<input {...undo.fields.slotId.as('hidden', act.slotId)} />
											<p class="text-muted text-sm">
												{m.staff_events_id_settle_dialog_undo_text({
													amount: formatCents(act.paidCents),
													name: act.actName ?? m.staff_not_bill_text()
												})}
											</p>
											<div class="flex gap-2">
												<Button
													type="button"
													variant="ghost"
													size="xs"
													onclick={() => (undoing = null)}
												>
													{m.staff_cancel_label()}
												</Button>
												<SubmitButton
													label={m.staff_events_id_settle_dialog_undo_label()}
													variant="warning"
													size="xs"
												/>
											</div>
										</Form>
									{:else}
										<span class="inline-flex items-center gap-1">
											<Badge variant="success" size="xs">{formatCents(act.paidCents)}</Badge>
											{#if canPayout && !locked}
												<Button variant="ghost" size="xs" onclick={() => (undoing = act.slotId)}>
													{m.staff_events_id_settle_dialog_undo_label()}
												</Button>
											{/if}
										</span>
									{/if}
								</td>
							</tr>
						{/each}
					</Table>
				{/if}

				{#if !readonly && canPayout && unpaid.length > 0}
					<Form
						remote={payouts}
						successToast={m.staff_events_id_settle_dialog_recorded_toast()}
						onsuccess={() => (open = false)}
						class="mt-3 flex flex-col gap-3"
					>
						<input {...payouts.fields.productionId.as('hidden', settlement.productionId)} />
						{#each unpaid as act, i (act.slotId)}
							<div
								role="group"
								aria-labelledby="payout-{act.slotId}"
								class="grid items-end gap-3 border-b border-base-300 pb-3 sm:grid-cols-3"
							>
								<div>
									<p id="payout-{act.slotId}" class="font-medium">
										{act.actName ?? m.staff_not_bill_text()}
									</p>
									<p class="text-sm text-fg-2">{dealText(act)}</p>
								</div>
								<input {...payouts.fields.payouts[i].slotId.as('hidden', act.slotId)} />
								{#if donated[act.slotId]}
									<p class="text-muted">{formatCents(0)}</p>
								{:else}
									<MoneyField
										field={payouts.fields.payouts[i].amountCents}
										label={m.staff_events_id_settle_dialog_payout_label()}
										value={act.suggestedPayoutCents}
										oncents={(cents) => (amounts[act.slotId] = cents)}
									/>
								{/if}
								<FormField
									field={payouts.fields.payouts[i].donated}
									type="checkbox"
									checkboxLabel={m.staff_events_id_settle_dialog_donated_checkbox()}
									bind:value={donated[act.slotId]}
								/>
							</div>
						{/each}
						<div class="flex items-center justify-between gap-3">
							<p class="font-medium">
								{m.staff_events_id_settle_dialog_total_text()}:
								<span data-testid="settle-total" data-cents={total}>{formatCents(total)}</span>
							</p>
							<SubmitButton label={m.staff_events_id_settle_dialog_record_label()} />
						</div>
					</Form>
				{:else if settlement.settled}
					<p class="mt-3 text-sm text-success">
						{m.staff_events_id_settle_dialog_settled_text({
							amount: formatCents(settlement.paidTotalCents)
						})}
					</p>
				{/if}
			{/if}
		</InfoCard>
	</div>
</Modal>
