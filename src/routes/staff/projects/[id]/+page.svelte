<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { EntityCard } from '$lib/components/ui/entity';
	import Table from '$lib/components/ui/Table.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import BallotLine from '$lib/components/ballot/BallotLine.svelte';
	import CreateBallotAction from '$lib/components/ballot/CreateBallotAction.svelte';
	import {
		getProjectDetail,
		updateProjectForm,
		setProjectStatusForm,
		attachToProjectForm,
		detachFromProjectForm,
		applyDutyListToProjectForm
	} from '$lib/remote/projects.remote';
	import { projectStatusOptions } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { rowLink } from '$lib/actions/row-link';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { IconSquare, IconSquareCheck, IconSquareX } from '@tabler/icons-svelte';

	/**
	 * One project: the work it is made of first, then what it has cost.
	 *
	 * Cash and contributed value are two tables rather than two rows of one,
	 * because they must never look addable: donated hours are worth reporting to
	 * a funder and worth nothing against a budget. Spent-of-budget is the only
	 * figure that leads; the breakdown sits at the end (#1800).
	 */
	const data = $derived(await getProjectDetail(page.params.id!));
	const project = $derived(data.project);
	const burn = $derived(data.burn);
	const origin = $derived(data.origin);

	const editFields = updateProjectForm.fields;
	const statusFields = setProjectStatusForm.fields;
	const attachFields = attachToProjectForm.fields;
	const detachFields = detachFromProjectForm.fields;
	const applyFields = applyDutyListToProjectForm.fields;
	const dutyListOptions = $derived(data.dutyLists.map((l) => ({ value: l.id, label: l.name })));

	const committeeOptions = $derived(data.committees.map((c) => ({ value: c.id, label: c.name })));
	const suggestionOptions = $derived(
		data.suggestions.map((s) => ({ value: s.id, label: s.title }))
	);
	const owner = $derived(data.projectCommittees.find((c) => c.role === 'owner') ?? null);
	const committeeNames = $derived(data.projectCommittees.map((c) => c.name).join(', '));
	const overBudget = $derived(burn.remainingCents !== null && burn.remainingCents < 0);

	/**
	 * `formatCents` puts the sign inside the symbol — `$-109.00` — which reads as
	 * a typo rather than as an overrun. Only this page shows a negative amount,
	 * so the fix belongs here rather than in the shared formatter.
	 */
	const signedCents = (cents: number) =>
		cents < 0 ? `-${formatCents(Math.abs(cents))}` : formatCents(cents);
	const volunteerHours = $derived(burn.contributed.volunteerMinutes / 60);
	const specializedHours = $derived(burn.contributed.specializedVolunteerMinutes / 60);
	/** Specialized hours nobody has priced. Counted as zero, and said so. */
	const unpricedHours = $derived(burn.contributed.unpricedSpecializedMinutes / 60);
	const hrs = (h: number) => `${h.toFixed(h % 1 === 0 ? 0 : 1)} hrs`;

	const workOrders = $derived(data.attachments.workOrders);
	const doneCount = $derived(workOrders.filter((wo) => wo.resolvedAt && !wo.cancelledAt).length);
	const cancelledCount = $derived(workOrders.filter((wo) => wo.cancelledAt).length);
	/** Progress counts work orders, not tasks: they are what staff attach. Cancelled is not work. */
	const liveCount = $derived(workOrders.length - cancelledCount);

	/** Contractor jobs, orders and acquisitions share one table; the kind is the subline. */
	const otherWork = $derived([
		...data.attachments.jobs.map((job) => ({
			kind: 'contractor_job',
			kindLabel: 'Contractor job',
			id: job.id,
			label: job.summary,
			href: resolve(`/staff/contractors/jobs/${job.id}`),
			status: job.status as string | null,
			date: job.completedAt ?? job.scheduledFor,
			amount: job.costCents === null ? 'No invoice yet' : formatCents(job.costCents)
		})),
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

	/** A date input wants `YYYY-MM-DD`, and a `Date` renders as a full timestamp. */
	const asDateValue = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

	const attachKinds = [
		{ value: 'work_order', label: 'Work order' },
		{ value: 'contractor_job', label: 'Contractor job' },
		{ value: 'purchase_order', label: 'Purchase order' },
		{ value: 'acquisition', label: 'Acquisition' },
		{ value: 'event_listing', label: 'Event' }
	];
</script>

<PageHeader
	title={project.name}
	subtitle={committeeNames || 'No committee owns this yet'}
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

	{#if dutyListOptions.length > 0}
		<Action
			action={applyDutyListToProjectForm}
			label="Apply duty list"
			size="sm"
			modalTitle="Apply a duty list to {project.name}"
			submitLabel="Apply"
			successToast="Work orders created"
		>
			{#snippet form()}
				<input {...applyFields.projectId.as('hidden', project.id)} />
				{#if project.startsAt}
					<Field
						field={applyFields.dutyListId}
						type="select"
						label="Duty list"
						options={dutyListOptions}
						description="Creates every work order the list describes, timed from the project's start date. Applying the same list twice is refused."
					/>
				{:else}
					<Alert type="warning">
						This project has no start date. Set one under Edit before applying a duty list.
					</Alert>
				{/if}
			{/snippet}
		</Action>
	{/if}

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
				value={owner?.groupId ?? ''}
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
	{#if data.attachments.events.length > 0}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each data.attachments.events as ev (ev.id)}
				<EntityCard ref={ev.ref} media="none">
					{#snippet facts()}
						<DefinitionList>
							<Fact label="When">{formatDateShort(ev.startsAt)}</Fact>
						</DefinitionList>
					{/snippet}
					{#snippet actions()}
						{@render detach('event', ev.id, ev.title)}
					{/snippet}
				</EntityCard>
			{/each}
		</div>
	{/if}

	<!-- Labelled and in a list: the status, the dates and the description sat
	     loose above the cards, in no box and with nothing naming them (#1080). -->
	<DefinitionList>
		<Fact label="Status"><StatusBadge status={project.status} label /></Fact>
		<Fact label="Dates">
			{#if project.startsAt}
				{formatDateShort(project.startsAt)}{project.endsAt
					? ` – ${formatDateShort(project.endsAt)}`
					: ' onward'}
			{:else}
				No dates set
			{/if}
		</Fact>
		{#if project.description}
			<Fact label="About">{project.description}</Fact>
		{/if}
	</DefinitionList>

	<Card>
		<CardBody>
			<div class="grid gap-6 sm:grid-cols-2">
				<div class="space-y-2">
					<SectionLabel label="Progress" />
					{#if liveCount > 0}
						<p class="text-2xl font-medium">
							{doneCount}<span class="text-subtle text-base"> of {liveCount} work orders done</span>
						</p>
						<progress
							class="progress w-full progress-success"
							value={doneCount}
							max={liveCount}
							aria-label="Work orders done"
						></progress>
					{:else}
						<p class="text-subtle">No work orders yet.</p>
					{/if}
					{#if cancelledCount > 0}
						<p class="text-subtle text-sm">{cancelledCount} cancelled, not counted.</p>
					{/if}
				</div>
				<div class="space-y-2">
					<SectionLabel label="Budget" />
					<p class="text-2xl font-medium">
						{formatCents(burn.cash.totalCents)}<span class="text-subtle text-base">
							{project.budgetCents === null
								? ' spent'
								: ` spent of ${formatCents(project.budgetCents)}`}</span
						>
					</p>
					<p class="text-sm {overBudget ? 'text-error' : 'text-subtle'}">
						{#if burn.remainingCents === null}
							No budget set
						{:else if overBudget}
							Over budget by {formatCents(Math.abs(burn.remainingCents))}
						{:else}
							{formatCents(burn.remainingCents)} remaining
						{/if}
					</p>
				</div>
			</div>
		</CardBody>
	</Card>

	<InfoCard
		title="Work orders"
		state={liveCount > 0 ? `${doneCount} of ${liveCount} done` : undefined}
	>
		{#if workOrders.length > 0}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Done</span></th>
					<th class="cell-primary">Work order</th>
					<th class="col-support cell-num">Filled</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each workOrders as wo (wo.id)}
					<tr
						class="hover cursor-pointer"
						use:rowLink={resolve(`/staff/volunteer/shifts/${wo.id}`)}
					>
						<td class="w-px">
							{#if wo.cancelledAt}
								<IconSquareX size={20} class="text-subtle" aria-label="Cancelled" />
							{:else if wo.resolvedAt}
								<IconSquareCheck size={20} class="text-success" aria-label="Done" />
							{:else}
								<IconSquare size={20} class="text-subtle" aria-label="Open" />
							{/if}
						</td>
						<td class="cell-primary">
							<a
								class="block truncate font-medium {wo.cancelledAt
									? 'text-subtle line-through'
									: ''}"
								href={resolve(`/staff/volunteer/shifts/${wo.id}`)}>{wo.title}</a
							>
							<div class="truncate text-subtle text-sm">
								{wo.startsAt ? formatDateShort(wo.startsAt) : 'Not scheduled'}
							</div>
						</td>
						<td class="col-support cell-num">{wo.claimed} / {wo.capacity}</td>
						<td class="w-px">{@render detach('work_order', wo.id, wo.title)}</td>
					</tr>
				{/each}
			</Table>
		{:else}
			<EmptyState
				title="No work orders"
				description="Apply a duty list, or attach a work order below."
			/>
		{/if}
	</InfoCard>

	<!-- Suggestion → ballot → this project, each a link. Either may be missing:
	     a failed breaker panel is a project nobody suggested or voted on. -->
	<InfoCard title="Why this exists">
		{#if !origin.suggestion && !origin.ballot && origin.decidedBy.length === 0}
			<p class="text-muted">Staff started this directly: no suggestion or ballot led to it.</p>
		{:else}
			<DefinitionList>
				{#if origin.suggestion}
					<Fact label="Suggested">
						<a class="link" href={resolve(`/staff/suggestions/${origin.suggestion.id}`)}>
							{origin.suggestion.title}
						</a>
					</Fact>
				{/if}
				{#if origin.ballot}
					<Fact label="Authorised by">
						<BallotLine
							ballot={origin.ballot}
							href={resolve(`/staff/ballots/${origin.ballot.id}`)}
						/>
					</Fact>
				{/if}
				{#each origin.decidedBy as b (b.id)}
					<Fact label="Put to a ballot">
						<BallotLine ballot={b} href={resolve(`/staff/ballots/${b.id}`)} />
					</Fact>
				{/each}
				<Fact label="Became">{project.name}</Fact>
			</DefinitionList>
		{/if}
		{#if data.canCreateBallot}
			<div class="mt-3">
				<CreateBallotAction
					kind="member"
					panel="staff"
					decides={{ projectId: project.id, title: project.name }}
				/>
			</div>
		{/if}
	</InfoCard>

	<InfoCard title="Attached work">
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

		{#if otherWork.length > 0}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th class="cell-primary">Item</th>
					<th class="col-support">Date</th>
					<th class="cell-num">Amount</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each otherWork as row (row.id)}
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
						<td class="w-px">{@render detach(row.kind, row.id, row.label)}</td>
					</tr>
				{/each}
			</Table>
		{:else}
			<EmptyState
				title="No other work attached"
				description="Attach a contractor job, an order or an acquisition, and its cost joins this project's burn."
			/>
		{/if}
	</InfoCard>

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
								The cost sheet and guarantee top-ups; the acts' pool passes through
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
				The first two rows are also not added to <em>each other</em> — a donated engineer's hour is in
				both, so they are two answers to two different questions rather than parts of one total.
			</p>
		</InfoCard>
	</div>
</PageContent>

<!--
	Detach is per row. It used to be one action asking for a `kind` and a
	UUID "copied from its own page" — while the complete list of attached
	rows, each with its id in scope, rendered directly beneath it (#1080).
-->
{#snippet detach(kind: string, rowId: string, label: string)}
	<Action
		action={detachFromProjectForm.for(rowId)}
		label="Detach"
		variant="ghost"
		size="xs"
		modalTitle="Detach {label}?"
		successToast="Detached"
	>
		{#snippet form()}
			<input {...detachFields.projectId.as('hidden', project.id)} />
			<input {...detachFields.kind.as('hidden', kind)} />
			<input {...detachFields.rowId.as('hidden', rowId)} />
			<p class="text-sm">
				Takes <strong>{label}</strong> off this project. The record itself is untouched.
			</p>
		{/snippet}
	</Action>
{/snippet}
