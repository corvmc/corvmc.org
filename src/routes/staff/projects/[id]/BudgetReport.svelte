<script lang="ts">
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
			kindLabel: order.reference ? `Purchase order ${order.reference}` : 'Purchase order',
			id: order.id,
			label: order.supplierName ?? 'Order',
			href: resolve(`/staff/inventory/orders/${order.id}`),
			status: order.status as string | null,
			date: order.placedAt,
			amount: '—'
		})),
		...data.attachments.acquisitions.map((acq) => ({
			kind: 'acquisition',
			kindLabel: 'Acquisition',
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
		{ value: 'purchase_order', label: 'Purchase order' },
		{ value: 'work_order', label: 'Work order (lands in the task list)' },
		{ value: 'acquisition', label: 'Acquisition' },
		{ value: 'event_listing', label: 'Event' }
	];
</script>

<div class="grid gap-4 lg:grid-cols-2">
	<InfoCard title="Cash">
		<Table>
			{#snippet head()}
				<th>Source</th>
				<th class="cell-num">Amount</th>
			{/snippet}
			<tr>
				<td>Contractors</td>
				<td class="cell-num">{formatCents(burn.cash.contractorCents)}</td>
			</tr>
			<tr>
				<td>Purchase orders</td>
				<td class="cell-num">{formatCents(burn.cash.purchaseOrderCents)}</td>
			</tr>
			<tr>
				<td>Acquisitions</td>
				<td class="cell-num">{formatCents(burn.cash.acquisitionCents)}</td>
			</tr>
			{#if project.kind === 'production' || burn.cash.showCents > 0}
				<tr>
					<td>
						Show costs
						<span class="block text-subtle text-xs">
							The cost sheet and guarantee top-ups; the bands' pool passes through
						</span>
					</td>
					<td class="cell-num">{formatCents(burn.cash.showCents)}</td>
				</tr>
			{/if}
			<tr class="font-medium">
				<td>Spent</td>
				<td class="cell-num">{formatCents(burn.cash.totalCents)}</td>
			</tr>
			<tr>
				<td>Budget</td>
				<td class="cell-num">
					{project.budgetCents === null ? 'None set' : formatCents(project.budgetCents)}
				</td>
			</tr>
			<tr class="font-medium">
				<td>Remaining</td>
				<td class="cell-num {overBudget ? 'text-error' : ''}">
					{burn.remainingCents === null ? '—' : signedCents(burn.remainingCents)}
				</td>
			</tr>
		</Table>
	</InfoCard>

	<InfoCard title="Contributed">
		<Table>
			{#snippet head()}
				<th>Source</th>
				<th class="cell-num">Value</th>
			{/snippet}
			<tr>
				<td>
					Volunteer time — impact value
					<span class="block text-subtle text-xs">
						{hrs(volunteerHours)}, every approved hour at {formatCents(
							burn.contributed.hourValueCents
						)}/hr
					</span>
				</td>
				<td class="cell-num">{formatCents(burn.contributed.volunteerValueCents)}</td>
			</tr>
			<tr>
				<td>
					Contributed services — specialized only
					<span class="block text-subtle text-xs">
						{hrs(specializedHours)} at each role's own rate{unpricedHours > 0
							? `, of which ${hrs(unpricedHours)} on roles with no rate set and counted as zero`
							: ''}
					</span>
				</td>
				<td class="cell-num">{formatCents(burn.contributed.recognizableServicesCents)}</td>
			</tr>
			<tr>
				<td>Donated services</td>
				<td class="cell-num">{formatCents(burn.contributed.donatedServicesCents)}</td>
			</tr>
			<tr>
				<td>Donated goods</td>
				<td class="cell-num">{formatCents(burn.contributed.donatedGoodsCents)}</td>
			</tr>
		</Table>
		<p class="mt-2 text-subtle text-sm">
			Never added to cash: donated time and goods belong in a grant report, not against a budget.
			The first two rows are also not added to <em>each other</em> — a donated engineer's hour is in both,
			so they are two answers to two different questions rather than parts of one total.
		</p>
	</InfoCard>
</div>

<InfoCard title="Orders and acquisitions">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle level={2}>{title}</CardTitle>
			<Action
				action={attachToProjectForm}
				label="Attach"
				size="sm"
				modalTitle="Attach to this project"
				successToast="Attached"
			>
				{#snippet form()}
					<input {...attachFields.projectId.as('hidden', project.id)} />
					<Field field={attachFields.kind} type="select" label="What" options={attachKinds} />
					<Field
						field={attachFields.rowId}
						type="text"
						label="Id"
						description="The row's id, copied from its own page."
					/>
				{/snippet}
			</Action>
		</div>
	{/snippet}

	{#if attached.length > 0}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th class="cell-primary">Item</th>
				<th class="col-support">Date</th>
				<th class="cell-num">Amount</th>
				<th class="w-px"><span class="sr-only">Actions</span></th>
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
							label="Detach"
							variant="ghost"
							size="xs"
							modalTitle="Detach {row.label}?"
							successToast="Detached"
						>
							{#snippet form()}
								<input {...detachFields.projectId.as('hidden', project.id)} />
								<input {...detachFields.kind.as('hidden', row.kind)} />
								<input {...detachFields.rowId.as('hidden', row.id)} />
								<p class="text-sm">
									Takes <strong>{row.label}</strong> off this project. The record itself is untouched.
								</p>
							{/snippet}
						</Action>
					</td>
				</tr>
			{/each}
		</Table>
	{:else}
		<EmptyState
			title="Nothing attached"
			description="Attach a purchase order or an acquisition and its cost joins this project's spend."
		/>
	{/if}
</InfoCard>
