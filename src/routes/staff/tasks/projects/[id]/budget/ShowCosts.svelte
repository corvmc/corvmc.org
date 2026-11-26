<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import MoneyField from '#lib/components/ui/Form/MoneyField.svelte';
	import { IconTrash } from '@tabler/icons-svelte';
	import { formatCents } from '#lib/utils/format.js';
	import { productionExpenseCategoryLabels, productionExpenseCategories } from '#lib/config.js';
	import { addProductionExpense, removeProductionExpense } from '#lib/remote/productions.remote.js';
	import type { getProjectDetail } from '#lib/remote/projects.remote.js';

	type Costs = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>['costs']>;

	/**
	 * The show's cost sheet, where the project's spend is read. Adding and removing
	 * are `production.run`; a closed or cancelled show is locked, as the server refuses it.
	 */
	let { costs, canEdit }: { costs: Costs; canEdit: boolean } = $props();

	const categoryOptions = productionExpenseCategories.map((c) => ({
		value: c,
		label: productionExpenseCategoryLabels[c]
	}));
	const editable = $derived(canEdit && !costs.locked);
	const total = $derived(costs.lines.reduce((t, l) => t + l.amountCents, 0));
	const deductible = $derived(
		costs.lines.filter((l) => l.deductible).reduce((t, l) => t + l.amountCents, 0)
	);
</script>

<InfoCard title={m.staff_events_id_production_settlement_panel_what_night_cost_title()}>
	{#snippet action()}
		{#if editable}
			<Action
				action={addProductionExpense}
				label={m.staff_events_id_production_settlement_panel_add_cost_label()}
				variant="ghost"
				size="xs"
				modalTitle={m.staff_events_id_production_settlement_panel_what_did_show_pa_title()}
				submitLabel={m.staff_events_id_production_settlement_panel_add_label()}
				successToast={m.staff_events_id_production_settlement_panel_cost_recorded_toast()}
			>
				{#snippet form()}
					<input {...addProductionExpense.fields.productionId.as('hidden', costs.productionId)} />
					<FormField
						field={addProductionExpense.fields.label}
						label={m.staff_description_label()}
						required
					/>
					<FormField
						field={addProductionExpense.fields.category}
						type="select"
						label={m.staff_category_label()}
						options={categoryOptions}
						value="sound"
					/>
					<MoneyField
						field={addProductionExpense.fields.amountCents}
						label={m.staff_amount_label()}
					/>
					<FormField
						field={addProductionExpense.fields.paidTo}
						label={m.staff_events_id_production_settlement_panel_paid_label()}
						description={m.staff_events_id_production_settlement_panel_who_was_handed_m_body()}
					/>
					<FormField
						field={addProductionExpense.fields.deductible}
						type="checkbox"
						label={m.staff_events_id_production_settlement_panel_deductible_2_label()}
						checkboxLabel={m.staff_events_id_production_settlement_panel_checkbox_label_checkbox()}
						value={true}
					/>
				{/snippet}
			</Action>
		{/if}
	{/snippet}

	{#if costs.lines.length === 0}
		<p class="text-fg-2">{m.staff_projects_id_budget_show_costs_nothing_recorded_text()}</p>
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_what_label()}</th>
				<th>{m.staff_category_label()}</th>
				<th>{m.staff_events_id_production_settlement_panel_paid_label()}</th>
				<th class="cell-num">{m.staff_amount_label()}</th>
				<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
			{/snippet}
			{#each costs.lines as line (line.id)}
				{@const drop = removeProductionExpense.for(line.id)}
				<tr>
					<td>
						{line.label}
						{#if !line.deductible}
							<Badge variant="neutral" size="xs"
								>{m.staff_events_id_production_settlement_panel_not_deductible_label()}</Badge
							>
						{/if}
					</td>
					<td class="text-sm text-fg-2">{productionExpenseCategoryLabels[line.category]}</td>
					<td class="text-sm text-fg-2">{line.paidTo ?? '—'}</td>
					<td class="cell-num">{formatCents(line.amountCents)}</td>
					<td class="w-px">
						{#if editable}
							<Action
								action={drop}
								label={m.staff_remove_label()}
								iconOnly
								icon={trashIcon}
								variant="ghost"
								size="xs"
								class="text-error"
								modalTitle={m.staff_events_id_production_settlement_panel_remove_cost_title()}
								submitLabel={m.staff_remove_label()}
								submitVariant="error"
								successToast={m.staff_events_id_production_settlement_panel_cost_removed_toast()}
							>
								{#snippet form()}
									<input {...drop.fields.expenseId.as('hidden', line.id)} />
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>

		{#if deductible !== total}
			<p class="mt-3 text-sm text-fg-2">
				{m.staff_events_id_production_settlement_panel_comes_off_door_b_text({
					formatCents: formatCents(deductible),
					formatCents2: formatCents(total)
				})}
			</p>
		{/if}
	{/if}
</InfoCard>

{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}
