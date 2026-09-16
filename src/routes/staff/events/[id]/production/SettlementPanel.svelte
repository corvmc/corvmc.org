<script lang="ts">
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
	import {
		recordActPayout,
		addProductionExpense,
		removeProductionExpense
	} from '$lib/remote/productions.remote';
	import { productionExpenseCategoryLabels, productionExpenseCategories } from '$lib/config';
	import { IconTrash } from '@tabler/icons-svelte';
	import type { Settlement } from '$lib/server/production/settlement-service';

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
</script>

{#if !settlement}
	<EmptyState title="No production" description="Open one from the event page first." />
{:else}
	<Alert type="info">
		What the night took, what it cost, and what each act is owed under its own deal. Recording a
		payout writes it against the show's pool in the financial record — the app does not move the
		money, it keeps the account of it.
	</Alert>

	<InfoCard title="The night">
		<div class="grid gap-6 sm:grid-cols-4">
			<div>
				<p class="text-muted">Acts' pool</p>
				<p class="text-lg font-medium">{formatCents(settlement.actsPoolCents)}</p>
				<p class="text-xs text-fg-2">What buyers designated</p>
			</div>
			<div>
				<p class="text-muted">Collective</p>
				<p class="text-lg font-medium">{formatCents(settlement.collectiveRevenueCents)}</p>
			</div>
			<div>
				<p class="text-muted">Expenses</p>
				<p class="text-lg font-medium">{formatCents(settlement.expensesCents)}</p>
				{#if settlement.deductibleExpensesCents !== settlement.expensesCents}
					<p class="text-xs text-fg-2">
						{formatCents(settlement.deductibleExpensesCents)} deductible
					</p>
				{/if}
			</div>
			<div>
				<p class="text-muted">Net</p>
				<p class="text-lg font-medium" class:text-error={settlement.netCents < 0}>
					{formatCents(settlement.netCents)}
				</p>
			</div>
		</div>
	</InfoCard>

	<InfoCard title="What the night cost">
		{#snippet header(title)}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				<Action
					action={addProductionExpense}
					label="Add a cost"
					variant="ghost"
					size="xs"
					modalTitle="What did the show pay for?"
					submitLabel="Add it"
					successToast="Cost recorded"
				>
					{#snippet form()}
						<input {...addProductionExpense.fields.eventId.as('hidden', eventId)} />
						<input
							{...addProductionExpense.fields.productionId.as('hidden', settlement.productionId)}
						/>
						<FormField field={addProductionExpense.fields.label} label="What it was" required />
						<FormField
							field={addProductionExpense.fields.category}
							type="select"
							label="Category"
							options={categoryOptions}
							value="sound"
						/>
						<MoneyField field={addProductionExpense.fields.amountCents} label="Amount" />
						<FormField
							field={addProductionExpense.fields.paidTo}
							label="Paid to"
							description="Who was handed the money. Optional."
						/>
						<FormField
							field={addProductionExpense.fields.deductible}
							type="checkbox"
							label="Deductible"
							checkboxLabel="Comes off the door before a percentage-of-net deal is worked out"
							value={true}
						/>
					{/snippet}
				</Action>
			</div>
		{/snippet}

		{#if expenses.length === 0}
			<p class="text-fg-2">
				Nothing recorded. Until a cost is entered here the Expenses figure above is zero and an
				against-net deal divides the whole pool.
			</p>
		{:else}
			<Table>
				{#snippet head()}
					<th>What</th>
					<th>Category</th>
					<th>Paid to</th>
					<th class="text-right">Amount</th>
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
								<Badge variant="neutral" size="xs">Not deductible</Badge>
							{/if}
						</td>
						<td class="text-sm text-fg-2">{productionExpenseCategoryLabels[expense.category]}</td>
						<td class="text-sm text-fg-2">{expense.paidTo ?? '—'}</td>
						<td class="text-right font-medium">{formatCents(expense.amountCents)}</td>
						<td class="text-right">
							<Action
								action={drop}
								label="Remove"
								iconOnly
								icon={trashIcon}
								variant="ghost"
								size="xs"
								class="text-error"
								modalTitle="Remove this cost?"
								submitLabel="Remove"
								submitVariant="error"
								successToast="Cost removed"
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
					{formatCents(settlement.deductibleExpensesCents)} of {formatCents(
						settlement.expensesCents
					)} comes off the door before an against-net deal is worked out.
				</p>
			{/if}
		{/if}
	</InfoCard>

	<InfoCard title="What each act is owed">
		{#if acts.length === 0}
			<p class="text-fg-2">No acts on the running order yet.</p>
		{:else}
			<Table>
				{#snippet head()}
					<th>Act</th>
					<th class="text-right">Designated</th>
					<th>Deal</th>
					<th class="text-right">Suggested</th>
					<th class="text-right">Paid</th>
				{/snippet}
				{#each acts as act (act.slotId)}
					<tr>
						<td>{act.actName ?? 'Not on the bill'}</td>
						<td class="text-right">{formatCents(act.designatedCents)}</td>
						<td class="text-sm text-fg-2">
							{#if act.contributed}
								Donated set
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
								<Badge variant="success" size="xs">{formatCents(act.paidCents)}</Badge>
							{:else}
								<!-- The amount is staff's, not the worksheet's: a settlement is a
								     conversation at the end of the night, and what changed hands is
								     the number that matters afterwards. -->
								<Action
									action={recordActPayout.for(act.slotId)}
									label="Record"
									variant="ghost"
									size="xs"
									modalTitle="What did {act.actName ?? 'the act'} take?"
									submitLabel="Record it"
									successToast="Recorded"
								>
									{#snippet form()}
										<input {...fields.eventId.as('hidden', eventId)} />
										<input {...fields.slotId.as('hidden', act.slotId)} />
										<FormField
											field={fields.amountCents}
											type="number"
											label="Paid"
											step="1"
											min="0"
											value={String(act.suggestedPayoutCents)}
											description="In cents. The deal suggests {formatCents(
												act.suggestedPayoutCents
											)} — change it if the night went differently. A donated set records zero."
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
					{settlement.unpaidActCount === 1 ? 'act has' : 'acts have'} no payout recorded. A donated set
					still records zero — otherwise the night reads as permanently outstanding.
				</p>
			{:else if acts.length > 0}
				<p class="mt-3 text-sm text-success">
					Everybody settled — {formatCents(settlement.paidTotalCents)} paid out.
				</p>
			{/if}

			{#if topUpTotal > 0}
				<!-- The number a programming committee should see: what the guarantees
				     cost beyond what the door designated. Never netted away. -->
				<p class="mt-3 text-sm text-fg-2">
					{formatCents(topUpTotal)} of this is the collective topping up guarantees above what buyers
					designated.
				</p>
			{/if}
		{/if}
	</InfoCard>
{/if}

{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}
