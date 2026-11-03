<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import { formatCents } from '$lib/utils/format';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import MoneyField from '$lib/components/ui/Form/MoneyField.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import {
		recordActPayout,
		undoActPayout,
		recordDoorTake,
		addProductionExpense,
		removeProductionExpense
	} from '$lib/remote/productions.remote';
	import { productionExpenseCategoryLabels, productionExpenseCategories } from '$lib/config';
	import { IconTrash } from '@tabler/icons-svelte';
	import type { Settlement } from '$lib/server/production/settlement-service';
	import { isTerminalProduction } from '$lib/production/status';
	import type { ProductionStatus } from '$lib/server/db/schema/production';

	let { settlement, eventId }: { settlement: Settlement | null; eventId: string } = $props();

	const { fields } = recordActPayout;

	const categoryOptions = productionExpenseCategories.map((c) => ({
		value: c,
		label: productionExpenseCategoryLabels[c]
	}));

	/** What each act was designated versus what its deal produces. */
	const acts = $derived(settlement?.acts ?? []);
	const expenses = $derived(settlement?.expenses ?? []);
	const topUpTotal = $derived(acts.reduce((t, a) => t + a.topUpCents, 0));
	/** Closed or cancelled: the worksheet is the record now. The server refuses edits too. */
	const locked = $derived(
		settlement ? isTerminalProduction(settlement.status as ProductionStatus) : false
	);
</script>

{#if !settlement}
	<EmptyState
		title={m.staff_no_production()}
		description={m.staff_events_id_production_settlement_panel_open_one_from_ev()}
	/>
{:else}
	<Alert type="info">
		{m.staff_events_id_production_settlement_panel_what_night_took()}
	</Alert>

	<InfoCard title={m.staff_night()}>
		<div class="grid gap-6 sm:grid-cols-4">
			<div>
				<p class="text-muted">{m.staff_events_id_production_settlement_panel_bands_pool()}</p>
				<p class="text-lg font-medium">{formatCents(settlement.actsPoolCents)}</p>
				<p class="text-xs text-fg-2">
					{m.staff_events_id_production_settlement_panel_what_buyers_desi()}{#if settlement.door}{m.staff_events_id_production_settlement_panel_plus_door(
							{ formatCents: formatCents(settlement.door.actsCents) }
						)}{/if}
				</p>
			</div>
			<div>
				<p class="text-muted">{m.staff_events_id_production_settlement_panel_collective()}</p>
				<p class="text-lg font-medium">{formatCents(settlement.collectiveRevenueCents)}</p>
			</div>
			<div>
				<p class="text-muted">{m.staff_events_id_production_settlement_panel_expenses()}</p>
				<p class="text-lg font-medium">{formatCents(settlement.expensesCents)}</p>
				{#if settlement.deductibleExpensesCents !== settlement.expensesCents}
					<p class="text-xs text-fg-2">
						{m.staff_events_id_production_settlement_panel_deductible({
							formatCents: formatCents(settlement.deductibleExpensesCents)
						})}
					</p>
				{/if}
			</div>
			<div>
				<p class="text-muted">{m.staff_events_id_production_settlement_panel_net()}</p>
				<p class="text-lg font-medium" class:text-error={settlement.netCents < 0}>
					{formatCents(settlement.netCents)}
				</p>
			</div>
		</div>
	</InfoCard>

	<!-- The drawer, and the split that follows from it. Its own card because
	     counting the door is a thing somebody does at the end of the night,
	     not a figure that arrives on its own like a ticket sale (#929). -->
	<InfoCard title={m.staff_events_id_production_settlement_panel_door()}>
		<Form
			remote={recordDoorTake}
			successToast={m.staff_events_id_production_settlement_panel_door_recorded()}
		>
			<input {...recordDoorTake.fields.id.as('hidden', settlement.productionId)} />
			<input {...recordDoorTake.fields.eventId.as('hidden', eventId)} />

			<div class="grid gap-3 sm:grid-cols-4">
				<MoneyField
					field={recordDoorTake.fields.doorCashCents}
					label={m.staff_events_id_production_settlement_panel_cash_counted()}
					value={settlement.door?.cashCents ?? null}
				/>
				<FormField
					{...recordDoorTake.fields.doorCount.as('number')}
					label={m.staff_events_id_production_settlement_panel_through_door()}
					value={settlement.door?.count ?? undefined}
					min={0}
				/>
				<FormField
					{...recordDoorTake.fields.splitActsPercent.as('number')}
					label={m.staff_events_id_production_settlement_panel_bands_share()}
					description={m.staff_events_id_production_settlement_panel_blank_house_rule()}
					value={settlement.door?.overridden ? settlement.door.actsPercent : undefined}
					min={0}
					max={100}
				/>
				{#if !locked}
					<div class="flex items-end">
						<SubmitButton label={m.staff_record()} size="sm" />
					</div>
				{/if}
			</div>
		</Form>

		{#if settlement.door}
			<p class="mt-3 text-muted">
				<ParaglideMessage
					message={m.staff_events_id_production_settlement_panel_splits_bands_col}
					inputs={{
						formatCents: formatCents(settlement.door.cashCents),
						actsPercent: settlement.door.actsPercent,
						value: 100 - settlement.door.actsPercent,
						formatCents2: formatCents(settlement.door.actsCents),
						formatCents3: formatCents(settlement.door.collectiveCents)
					}}
					>{#snippet strong({ children })}<strong>{@render children?.()}</strong
						>{/snippet}</ParaglideMessage
				>
				{#if settlement.door.overridden}
					<Badge size="sm" variant="warning"
						>{m.staff_events_id_production_settlement_panel_show_s_own_split()}</Badge
					>
				{/if}
			</p>
		{:else}
			<!-- Absent, not zero. A night nobody counted is not a night that took
			     nothing, and a settlement cannot be honest about the difference
			     unless the page is. -->
			<p class="mt-3 text-muted">
				{m.staff_events_id_production_settlement_panel_nobody_has_count()}
			</p>
		{/if}
	</InfoCard>

	<InfoCard title={m.staff_events_id_production_settlement_panel_what_night_cost()}>
		{#snippet header(title)}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				<Action
					disabled={locked}
					action={addProductionExpense}
					label={m.staff_events_id_production_settlement_panel_add_cost()}
					variant="ghost"
					size="xs"
					modalTitle={m.staff_events_id_production_settlement_panel_what_did_show_pa()}
					submitLabel={m.staff_events_id_production_settlement_panel_add()}
					successToast={m.staff_events_id_production_settlement_panel_cost_recorded()}
				>
					{#snippet form()}
						<input {...addProductionExpense.fields.eventId.as('hidden', eventId)} />
						<input
							{...addProductionExpense.fields.productionId.as('hidden', settlement.productionId)}
						/>
						<FormField
							field={addProductionExpense.fields.label}
							label={m.staff_what_was()}
							required
						/>
						<FormField
							field={addProductionExpense.fields.category}
							type="select"
							label={m.staff_category()}
							options={categoryOptions}
							value="sound"
						/>
						<MoneyField field={addProductionExpense.fields.amountCents} label={m.staff_amount()} />
						<FormField
							field={addProductionExpense.fields.paidTo}
							label={m.staff_events_id_production_settlement_panel_paid()}
							description={m.staff_events_id_production_settlement_panel_who_was_handed_m()}
						/>
						<FormField
							field={addProductionExpense.fields.deductible}
							type="checkbox"
							label={m.staff_events_id_production_settlement_panel_deductible_2()}
							checkboxLabel={m.staff_events_id_production_settlement_panel_checkbox_label()}
							value={true}
						/>
					{/snippet}
				</Action>
			</div>
		{/snippet}

		{#if expenses.length === 0}
			<p class="text-fg-2">
				{m.staff_events_id_production_settlement_panel_nothing_recorded()}
			</p>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_what()}</th>
					<th>{m.staff_category()}</th>
					<th>{m.staff_events_id_production_settlement_panel_paid()}</th>
					<th class="text-right">{m.staff_amount()}</th>
					<th></th>
				{/snippet}
				{#each expenses as expense (expense.id)}
					{@const drop = removeProductionExpense.for(expense.id)}
					<tr>
						<td>
							{expense.label}
							{#if !expense.deductible}
								<!-- A cost the collective carries whatever happens is real spend, but
								     it is not the act's to share. That distinction is what
								     `againstNet` means, so it has to be visible on the line. -->
								<Badge variant="neutral" size="xs"
									>{m.staff_events_id_production_settlement_panel_not_deductible()}</Badge
								>
							{/if}
						</td>
						<td class="text-sm text-fg-2">{productionExpenseCategoryLabels[expense.category]}</td>
						<td class="text-sm text-fg-2">{expense.paidTo ?? '—'}</td>
						<td class="text-right font-medium">{formatCents(expense.amountCents)}</td>
						<td class="text-right">
							<Action
								disabled={locked}
								action={drop}
								label={m.staff_remove()}
								iconOnly
								icon={trashIcon}
								variant="ghost"
								size="xs"
								class="text-error"
								modalTitle={m.staff_events_id_production_settlement_panel_remove_cost()}
								submitLabel={m.staff_remove()}
								submitVariant="error"
								successToast={m.staff_events_id_production_settlement_panel_cost_removed()}
							>
								{#snippet form()}
									<input {...drop.fields.eventId.as('hidden', eventId)} />
									<input {...drop.fields.expenseId.as('hidden', expense.id)} />
								{/snippet}
							</Action>
						</td>
					</tr>
				{/each}
			</Table>

			{#if settlement.deductibleExpensesCents !== settlement.expensesCents}
				<p class="mt-3 text-sm text-fg-2">
					{m.staff_events_id_production_settlement_panel_comes_off_door_b({
						formatCents: formatCents(settlement.deductibleExpensesCents),
						formatCents2: formatCents(settlement.expensesCents)
					})}
				</p>
			{/if}
		{/if}
	</InfoCard>

	<InfoCard title={m.staff_events_id_production_settlement_panel_what_each_band_o()}>
		{#if acts.length === 0}
			<p class="text-fg-2">{m.staff_events_id_production_settlement_panel_no_bands_running()}</p>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_band()}</th>
					<th class="text-right">{m.staff_events_id_production_settlement_panel_designated()}</th>
					<th>{m.staff_events_id_production_settlement_panel_deal()}</th>
					<th class="text-right">{m.staff_suggested()}</th>
					<th class="text-right">{m.staff_paid()}</th>
				{/snippet}
				{#each acts as act (act.slotId)}
					<tr>
						<td>{act.actName ?? 'Not on the bill'}</td>
						<td class="text-right">{formatCents(act.designatedCents)}</td>
						<td class="text-sm text-fg-2">
							{#if act.contributed}
								{m.staff_events_id_production_settlement_panel_donated_set()}
							{:else}
								{#if act.guaranteeCents}{formatCents(act.guaranteeCents)}{/if}
								{#if act.guaranteeCents && act.percentageBps}
									{act.versus ? ' versus ' : ' plus '}
								{/if}
								{#if act.percentageBps}{(act.percentageBps / 100).toFixed(0)}% of the
									{act.againstNet ? 'net' : 'pool'}{/if}
							{/if}
						</td>
						<td class="text-right font-medium">{formatCents(act.suggestedPayoutCents)}</td>
						<td class="text-right">
							{#if act.paidCents !== null}
								{@const undo = undoActPayout.for(act.slotId)}
								<span class="inline-flex items-center gap-1">
									<Badge variant="success" size="xs">{formatCents(act.paidCents)}</Badge>
									{#if !locked}
										<!-- Money already moved is undone, never edited: reversing rows for
										     this act alone, then it can be recorded again. -->
										<Action
											action={undo}
											label={m.staff_undo()}
											variant="ghost"
											size="xs"
											modalTitle={m.staff_events_id_production_settlement_panel_undo_s_payout({
												value: act.actName ?? 'the band'
											})}
											submitLabel={m.staff_events_id_production_settlement_panel_undo_payout()}
											submitVariant="warning"
											successToast={m.staff_events_id_production_settlement_panel_payout_undone()}
										>
											{#snippet form()}
												<input {...undo.fields.eventId.as('hidden', eventId)} />
												<input {...undo.fields.slotId.as('hidden', act.slotId)} />
												<p class="text-muted">
													{m.staff_events_id_production_settlement_panel_writes_reversing({
														formatCents: formatCents(act.paidCents ?? 0)
													})}
												</p>
											{/snippet}
										</Action>
									{/if}
								</span>
							{:else if locked}
								<span class="text-sm text-fg-2"
									>{m.staff_events_id_production_settlement_panel_unpaid()}</span
								>
							{:else}
								<!-- The amount is staff's, not the worksheet's: a settlement is a
								     conversation at the end of the night, and what changed hands is
								     the number that matters afterwards. -->
								<Action
									action={recordActPayout.for(act.slotId)}
									label={m.staff_record()}
									variant="ghost"
									size="xs"
									modalTitle={m.staff_events_id_production_settlement_panel_what_did_take({
										value: act.actName ?? 'the band'
									})}
									submitLabel={m.staff_events_id_production_settlement_panel_record()}
									successToast={m.staff_events_id_production_settlement_panel_recorded()}
								>
									{#snippet form()}
										<input {...fields.eventId.as('hidden', eventId)} />
										<input {...fields.slotId.as('hidden', act.slotId)} />
										<FormField
											field={fields.amountCents}
											type="number"
											label={m.staff_paid()}
											step="1"
											min="0"
											value={String(act.suggestedPayoutCents)}
											description={m.staff_events_id_production_settlement_panel_cents_deal_sugge({
												formatCents: formatCents(act.suggestedPayoutCents)
											})}
										/>
									{/snippet}
								</Action>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>

			{#if settlement.unpaidActCount > 0}
				<p class="mt-3 text-sm text-warning">
					{settlement.unpaidActCount}
					{settlement.unpaidActCount === 1 ? 'band has' : 'bands have'} no payout recorded. A donated
					set still records zero — otherwise the night reads as permanently outstanding.
				</p>
			{:else if acts.length > 0}
				<p class="mt-3 text-sm text-success">
					{m.staff_events_id_production_settlement_panel_everybody_settle({
						formatCents: formatCents(settlement.paidTotalCents)
					})}
				</p>
			{/if}

			{#if topUpTotal > 0}
				<!-- The number a programming committee should see: what the guarantees
				     cost beyond what the door designated. Never netted away. -->
				<p class="mt-3 text-sm text-fg-2">
					{m.staff_events_id_production_settlement_panel_collective_toppi({
						formatCents: formatCents(topUpTotal)
					})}
				</p>
			{/if}
		{/if}
	</InfoCard>
{/if}

{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}
