<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { attachToProjectForm, detachFromProjectForm } from '$lib/remote/projects.remote';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import type { ProjectDetail } from './task-view';

	/**
	 * What the project has cost. Cash and contributed value are two tables
	 * rather than two rows of one, because they must never look addable: donated
	 * hours are worth reporting to a funder and worth nothing against a budget.
	 * Contractor engagements are tasks, so they are on the task list, not here.
	 */
	let { data }: { data: ProjectDetail } = $props();

	const project = $derived(data.project);
	const burn = $derived(data.burn);
	const overBudget = $derived(burn.remainingCents !== null && burn.remainingCents < 0);
	const attachFields = attachToProjectForm.fields;
	const detachFields = detachFromProjectForm.fields;

	/** `formatCents` puts the sign inside the symbol, `$-109.00`, which reads as a typo. */
	const signedCents = (cents: number) =>
		cents < 0 ? `-${formatCents(Math.abs(cents))}` : formatCents(cents);
	const hrs = (h: number) => `${h.toFixed(h % 1 === 0 ? 0 : 1)} hrs`;
	const volunteerHours = $derived(burn.contributed.volunteerMinutes / 60);
	const specializedHours = $derived(burn.contributed.specializedVolunteerMinutes / 60);
	const unpricedHours = $derived(burn.contributed.unpricedSpecializedMinutes / 60);

	const attached = $derived([
		...data.attachments.orders.map((order) => ({
			kind: 'purchase_order',
			kindLabel: order.reference
				? m.staff_projects_id_budget_report_purchase_order({ reference: order.reference })
				: m.staff_projects_id_budget_report_purchase_order_2(),
			id: order.id,
			label: order.supplierName ?? m.staff_order_2(),
			href: resolve(`/staff/inventory/orders/${order.id}`),
			status: order.status as string | null,
			date: order.placedAt,
			amount: '—'
		})),
		...data.attachments.acquisitions.map((acq) => ({
			kind: 'acquisition',
			kindLabel: m.staff_acquisition(),
			id: acq.id,
			label: acq.sourceName ?? acq.kind,
			href: resolve(`/staff/inventory/acquisitions/${acq.id}`),
			status: null,
			date: acq.occurredAt as Date | null,
			amount: acq.totalCents
				? formatCents(acq.totalCents)
				: acq.fairValueCents
					? `${formatCents(acq.fairValueCents)} donated`
					: '—'
		}))
	]);

	const attachKinds = [
		{ value: 'purchase_order', label: m.staff_projects_id_budget_report_purchase_order_2() },
		{ value: 'work_order', label: m.staff_projects_id_budget_report_work_order_lands_task_list() },
		{ value: 'acquisition', label: m.staff_acquisition() },
		{ value: 'event_listing', label: m.staff_event() }
	];
</script>

<div class="grid gap-4 lg:grid-cols-2">
	<InfoCard title={m.staff_projects_id_budget_report_cash()}>
		<Table>
			{#snippet head()}
				<th>{m.staff_source()}</th>
				<th class="cell-num">{m.staff_amount()}</th>
			{/snippet}
			<tr>
				<td>{m.staff_projects_id_budget_report_contractors()}</td>
				<td class="cell-num">{formatCents(burn.cash.contractorCents)}</td>
			</tr>
			<tr>
				<td>{m.staff_projects_id_budget_report_purchase_orders()}</td>
				<td class="cell-num">{formatCents(burn.cash.purchaseOrderCents)}</td>
			</tr>
			<tr>
				<td>{m.staff_acquisitions()}</td>
				<td class="cell-num">{formatCents(burn.cash.acquisitionCents)}</td>
			</tr>
			{#if project.kind === 'production' || burn.cash.showCents > 0}
				<tr>
					<td>
						<ParaglideMessage
							message={m.staff_projects_id_budget_report_show_costs}
							inputs={{
								staff_projects_id_budget_report_cost_sheet_guarantee_top_ups:
									m.staff_projects_id_budget_report_cost_sheet_guarantee_top_ups()
							}}
							>{#snippet span({ children })}<span class="block text-subtle text-xs"
									>{@render children?.()}</span
								>{/snippet}</ParaglideMessage
						>
					</td>
					<td class="cell-num">{formatCents(burn.cash.showCents)}</td>
				</tr>
			{/if}
			<tr class="font-medium">
				<td>{m.staff_spent()}</td>
				<td class="cell-num">{formatCents(burn.cash.totalCents)}</td>
			</tr>
			<tr>
				<td>{m.staff_budget()}</td>
				<td class="cell-num">
					{project.budgetCents === null ? m.staff_none_set() : formatCents(project.budgetCents)}
				</td>
			</tr>
			<tr class="font-medium">
				<td>{m.staff_remaining()}</td>
				<td class="cell-num {overBudget ? 'text-error' : ''}">
					{burn.remainingCents === null ? '—' : signedCents(burn.remainingCents)}
				</td>
			</tr>
		</Table>
	</InfoCard>

	<InfoCard title={m.staff_projects_id_budget_report_contributed()}>
		<Table>
			{#snippet head()}
				<th>{m.staff_source()}</th>
				<th class="cell-num">{m.staff_value()}</th>
			{/snippet}
			<tr>
				<td>
					<ParaglideMessage
						message={m.staff_projects_id_budget_report_volunteer_time_impact_value}
						inputs={{
							staff_projects_id_budget_report_every_approved_hour_at_hr:
								m.staff_projects_id_budget_report_every_approved_hour_at_hr({
									hrs: hrs(volunteerHours),
									formatCents: formatCents(burn.contributed.hourValueCents)
								})
						}}
						>{#snippet span({ children })}<span class="block text-subtle text-xs"
								>{@render children?.()}</span
							>{/snippet}</ParaglideMessage
					>
				</td>
				<td class="cell-num">{formatCents(burn.contributed.volunteerValueCents)}</td>
			</tr>
			<tr>
				<td>
					{m.staff_projects_id_budget_report_specialized()}
					<span class="block text-subtle text-xs">
						{unpricedHours > 0
							? m.staff_projects_id_budget_report_specialized_unpriced({
									hours: hrs(specializedHours),
									unpriced: hrs(unpricedHours)
								})
							: m.staff_projects_id_budget_report_specialized_rate({
									hours: hrs(specializedHours)
								})}
					</span>
				</td>
				<td class="cell-num">{formatCents(burn.contributed.recognizableServicesCents)}</td>
			</tr>
			<tr>
				<td>{m.staff_projects_id_budget_report_donated_services()}</td>
				<td class="cell-num">{formatCents(burn.contributed.donatedServicesCents)}</td>
			</tr>
			<tr>
				<td>{m.staff_projects_id_budget_report_donated_goods()}</td>
				<td class="cell-num">{formatCents(burn.contributed.donatedGoodsCents)}</td>
			</tr>
		</Table>
		<p class="mt-2 text-subtle text-sm">
			<ParaglideMessage
				message={m.staff_projects_id_budget_report_never_added_cash_donated_tim}
				inputs={{
					staff_projects_id_budget_report_each_other: m.staff_projects_id_budget_report_each_other()
				}}>{#snippet em({ children })}<em>{@render children?.()}</em>{/snippet}</ParaglideMessage
			>
		</p>
	</InfoCard>
</div>

<InfoCard title={m.staff_projects_id_budget_report_orders_acquisitions()}>
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle level={2}>{title}</CardTitle>
			<Action
				action={attachToProjectForm}
				label={m.staff_projects_id_budget_report_attach()}
				size="sm"
				modalTitle={m.staff_projects_id_budget_report_attach_project()}
				successToast={m.staff_projects_id_budget_report_attached()}
			>
				{#snippet form()}
					<input {...attachFields.projectId.as('hidden', project.id)} />
					<Field
						field={attachFields.kind}
						type="select"
						label={m.staff_what()}
						options={attachKinds}
					/>
					<Field
						field={attachFields.rowId}
						type="text"
						label={m.staff_projects_id_budget_report_id()}
						description={m.staff_projects_id_budget_report_row_s_id_copied_from()}
					/>
				{/snippet}
			</Action>
		</div>
	{/snippet}

	{#if attached.length > 0}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
				<th class="cell-primary">{m.staff_item()}</th>
				<th class="col-support">{m.staff_date()}</th>
				<th class="cell-num">{m.staff_amount()}</th>
				<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
			{/snippet}
			{#each attached as row (row.id)}
				<tr class="hover cursor-pointer" use:rowLink={row.href}>
					<td class="w-px">
						{#if row.status}<StatusBadge status={row.status} />{/if}
					</td>
					<td class="cell-primary">
						<a class="block truncate font-medium" href={row.href}>{row.label}</a>
						<div class="truncate text-subtle text-sm">{row.kindLabel}</div>
					</td>
					<td class="col-support whitespace-nowrap">
						{row.date ? formatDateShort(row.date) : '—'}
					</td>
					<td class="cell-num">{row.amount}</td>
					<td class="w-px">
						<Action
							action={detachFromProjectForm.for(row.id)}
							label={m.staff_projects_id_budget_report_detach()}
							variant="ghost"
							size="xs"
							modalTitle={m.staff_projects_id_budget_report_detach_2({ label: row.label })}
							successToast={m.staff_projects_id_budget_report_detached()}
						>
							{#snippet form()}
								<input {...detachFields.projectId.as('hidden', project.id)} />
								<input {...detachFields.kind.as('hidden', row.kind)} />
								<input {...detachFields.rowId.as('hidden', row.id)} />
								<p class="text-sm">
									<ParaglideMessage
										message={m.staff_projects_id_budget_report_takes_off_project_record_its}
										inputs={{ label: row.label }}
										>{#snippet strong({ children })}<strong>{@render children?.()}</strong
											>{/snippet}</ParaglideMessage
									>
								</p>
							{/snippet}
						</Action>
					</td>
				</tr>
			{/each}
		</Table>
	{:else}
		<EmptyState
			title={m.staff_projects_id_budget_report_nothing_attached()}
			description={m.staff_projects_id_budget_report_attach_purchase_order_acquis()}
		/>
	{/if}
</InfoCard>
