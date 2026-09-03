<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import {
		getProjectDetail,
		updateProjectForm,
		setProjectStatusForm,
		attachToProjectForm,
		detachFromProjectForm
	} from '$lib/remote/projects.remote';
	import { projectStatusOptions } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * One project: what it has cost, and what it is made of.
	 *
	 * Cash and contributed value are two tables rather than two rows of one,
	 * because they must never look addable. An electrician's invoice is money
	 * that left the account; donated hours are worth reporting to a funder and
	 * worth nothing against a budget, and a single column of figures invites
	 * exactly the total nobody should compute.
	 */
	const data = $derived(await getProjectDetail(page.params.id!));
	const project = $derived(data.project);
	const burn = $derived(data.burn);

	const editFields = updateProjectForm.fields;
	const statusFields = setProjectStatusForm.fields;
	const attachFields = attachToProjectForm.fields;
	const detachFields = detachFromProjectForm.fields;

	const committeeOptions = $derived(data.committees.map((c) => ({ value: c.id, label: c.name })));
	const suggestionOptions = $derived(
		data.suggestions.map((s) => ({ value: s.id, label: s.title }))
	);
	const committeeName = $derived(
		project.groupId ? (data.committees.find((c) => c.id === project.groupId)?.name ?? null) : null
	);
	const overBudget = $derived(burn.remainingCents !== null && burn.remainingCents < 0);

	/**
	 * `formatCents` puts the sign inside the symbol — `$-109.00` — which reads as
	 * a typo rather than as an overrun. Only this page shows a negative amount,
	 * so the fix belongs here rather than in the shared formatter.
	 */
	const signedCents = (cents: number) =>
		cents < 0 ? `-${formatCents(Math.abs(cents))}` : formatCents(cents);
	const volunteerHours = $derived(burn.contributed.volunteerMinutes / 60);

	/** A date input wants `YYYY-MM-DD`, and a `Date` renders as a full timestamp. */
	const asDateValue = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

	const attachKinds = [
		{ value: 'work_order', label: 'Work order' },
		{ value: 'contractor_job', label: 'Contractor job' },
		{ value: 'purchase_order', label: 'Purchase order' },
		{ value: 'acquisition', label: 'Acquisition' },
		{ value: 'event', label: 'Event' }
	];
</script>

<PageHeader
	title={project.name}
	subtitle={committeeName ?? 'No committee owns this yet'}
	backHref="/staff/projects"
>
	<Action
		action={setProjectStatusForm}
		label="Change status"
		size="sm"
		modalTitle="Change status"
		successToast="Status updated"
	>
		{#snippet form()}
			<input {...statusFields.id.as('hidden', project.id)} />
			<Field
				field={statusFields.status}
				type="select"
				label="Status"
				options={projectStatusOptions}
				value={project.status}
				description={project.suggestionId
					? 'The suggestion this answers moves with it.'
					: undefined}
			/>
		{/snippet}
	</Action>

	<Action
		action={updateProjectForm}
		label="Edit"
		size="sm"
		modalTitle="Edit project"
		successToast="Saved"
	>
		{#snippet form()}
			<input {...editFields.id.as('hidden', project.id)} />
			<Field field={editFields.name} type="text" label="Name" value={project.name} />
			<Field
				field={editFields.description}
				type="textarea"
				label="Description"
				value={project.description ?? ''}
			/>
			<Field
				field={editFields.groupId}
				type="select"
				label="Owning committee"
				options={committeeOptions}
				value={project.groupId ?? ''}
			/>
			<Field
				field={editFields.suggestionId}
				type="select"
				label="Answers the suggestion"
				options={suggestionOptions}
				value={project.suggestionId ?? ''}
				description="One project per suggestion. Its status follows this one from now on."
			/>
			<MoneyField field={editFields.budgetCents} label="Budget" value={project.budgetCents} />
			<Field
				field={editFields.startsAt}
				type="date"
				label="Starts"
				value={asDateValue(project.startsAt)}
			/>
			<Field
				field={editFields.endsAt}
				type="date"
				label="Ends"
				value={asDateValue(project.endsAt)}
			/>
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	<div class="flex flex-wrap items-center gap-3">
		<StatusBadge status={project.status} label />
		<span class="text-subtle">
			{#if project.startsAt}
				{formatDateShort(project.startsAt)}{project.endsAt
					? ` – ${formatDateShort(project.endsAt)}`
					: ' onward'}
			{:else}
				No dates set
			{/if}
		</span>
	</div>

	{#if project.description}
		<p>{project.description}</p>
	{/if}

	{#if overBudget}
		<Alert type="warning">
			Over budget by {formatCents(Math.abs(burn.remainingCents ?? 0))}.
		</Alert>
	{/if}

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
					<td>Volunteer time</td>
					<td class="cell-num">
						{volunteerHours.toFixed(volunteerHours % 1 === 0 ? 0 : 1)} hrs
					</td>
				</tr>
				<tr>
					<td>Donated goods</td>
					<td class="cell-num">{formatCents(burn.contributed.donatedGoodsCents)}</td>
				</tr>
			</Table>
			<p class="mt-2 text-subtle text-sm">
				Never added to cash: donated time and goods belong in a grant report, not against a budget.
				Hours carry no dollar value until the collective sets one.
			</p>
		</InfoCard>
	</div>

	<InfoCard title="Attached work">
		{#snippet header(title)}
			<div class="flex items-center justify-between gap-2">
				<CardTitle level={2}>{title}</CardTitle>
				<div class="flex gap-2">
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
					<Action
						action={detachFromProjectForm}
						label="Detach"
						variant="ghost"
						size="sm"
						modalTitle="Detach from this project"
						successToast="Detached"
					>
						{#snippet form()}
							<input {...detachFields.projectId.as('hidden', project.id)} />
							<Field field={detachFields.kind} type="select" label="What" options={attachKinds} />
							<Field field={detachFields.rowId} type="text" label="Id" />
						{/snippet}
					</Action>
				</div>
			</div>
		{/snippet}

		{#if data.attachments.jobs.length > 0}
			<h3 class="mt-2 font-medium">Contractor jobs</h3>
			<ul class="list-disc pl-5">
				{#each data.attachments.jobs as job (job.id)}
					<li>
						<a class="link" href={resolve(`/staff/contractors/jobs/${job.id}`)}>{job.summary}</a>
						— {job.costCents === null ? 'no invoice yet' : formatCents(job.costCents)}
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.attachments.workOrders.length > 0}
			<h3 class="mt-3 font-medium">Work orders</h3>
			<ul class="list-disc pl-5">
				{#each data.attachments.workOrders as wo (wo.id)}
					<li>
						{wo.notes ?? 'Unscheduled work order'}
						{wo.startsAt ? ` — ${formatDateShort(wo.startsAt)}` : ' — not scheduled'}
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.attachments.orders.length > 0}
			<h3 class="mt-3 font-medium">Purchase orders</h3>
			<ul class="list-disc pl-5">
				{#each data.attachments.orders as order (order.id)}
					<li>
						<a class="link" href={resolve(`/staff/inventory/orders`)}>
							{order.supplierName ?? 'Order'}
						</a>
						{order.reference ? ` — ${order.reference}` : ''}
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.attachments.acquisitions.length > 0}
			<h3 class="mt-3 font-medium">Acquisitions</h3>
			<ul class="list-disc pl-5">
				{#each data.attachments.acquisitions as acq (acq.id)}
					<li>
						{acq.sourceName ?? acq.kind}
						{acq.totalCents ? ` — ${formatCents(acq.totalCents)}` : ''}
						{acq.fairValueCents ? ` — ${formatCents(acq.fairValueCents)} donated` : ''}
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.attachments.events.length > 0}
			<h3 class="mt-3 font-medium">Events</h3>
			<ul class="list-disc pl-5">
				{#each data.attachments.events as ev (ev.id)}
					<li>
						<a class="link" href={resolve(`/staff/events/${ev.id}`)}>{ev.title}</a>
						— {formatDateShort(ev.startsAt)}
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.attachments.jobs.length === 0 && data.attachments.workOrders.length === 0 && data.attachments.orders.length === 0 && data.attachments.acquisitions.length === 0 && data.attachments.events.length === 0}
			<EmptyState
				title="Nothing attached"
				description="Attach a work order, a contractor job, an order, an acquisition or an event, and its cost joins this project's burn."
			/>
		{/if}
	</InfoCard>
</PageContent>
