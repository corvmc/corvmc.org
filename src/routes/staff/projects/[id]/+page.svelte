<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import BallotLine from '$lib/components/ballot/BallotLine.svelte';
	import CreateBallotAction from '$lib/components/ballot/CreateBallotAction.svelte';
	import {
		getProjectDetail,
		updateProjectForm,
		setProjectStatusForm,
		applyDutyListToProjectForm,
		getProjectActivity
	} from '$lib/remote/projects.remote';
	import {
		isProjectArchived,
		projectArchiveOutcomeOptions,
		PROJECT_UNARCHIVED_STATUS
	} from '$lib/config';
	import { formatDateShort } from '$lib/utils/format';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { IconCheck, IconDots } from '@tabler/icons-svelte';
	import ActivityCard from '$lib/components/project/ActivityCard.svelte';
	import TaskList from './TaskList.svelte';
	import TaskPanel from './TaskPanel.svelte';
	import { parseFilter, type TaskFilter } from './task-view';
	import { asDateValue } from './date-value';

	/**
	 * One project, run as a checklist: its work orders are the tasks, grouped in
	 * sections, with a panel beside the list for the one selected. The project's
	 * own fields change only through Edit project; they reach further than a task.
	 */
	// Above the await: the window listener below reads these.
	let filter = $state<TaskFilter>(parseFilter(page.url.searchParams.get('show')));
	let showDone = $state(page.url.searchParams.get('done') !== 'hide');
	const selectedId = $derived(page.url.searchParams.get('task'));

	/** View state lives in the URL, written with `goto`: `replaceState()` would not update `page.url`. */
	function setParams(changes: Record<string, string | null>, push = false) {
		const url = new URL(page.url);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		void goto(url, { replaceState: !push, noScroll: true, keepFocus: true });
	}

	const openTask = (id: string) => setParams({ task: id }, true);
	const closeTask = () => setParams({ task: null });

	function onkeydown(e: KeyboardEvent) {
		// A dialog or popover over the panel takes its own Escape first.
		if (e.key !== 'Escape' || !selectedId || e.defaultPrevented) return;
		if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
		closeTask();
	}

	const data = $derived(await getProjectDetail(page.params.id!));
	const project = $derived(data.project);
	const origin = $derived(data.origin);
	const list = $derived(data.taskList);
	const progress = $derived(list.progress);
	const selected = $derived(list.tasks.find((t) => t.id === selectedId) ?? null);

	const editFields = updateProjectForm.fields;
	const statusFields = setProjectStatusForm.fields;
	const applyFields = applyDutyListToProjectForm.fields;
	const dutyListOptions = $derived(data.dutyLists.map((l) => ({ value: l.id, label: l.name })));
	const committeeOptions = $derived(data.committees.map((c) => ({ value: c.id, label: c.name })));
	const suggestionOptions = $derived(
		data.suggestions.map((s) => ({ value: s.id, label: s.title }))
	);
	const owner = $derived(data.projectCommittees.find((c) => c.role === 'owner') ?? null);
	const committeeNames = $derived(data.projectCommittees.map((c) => c.name).join(', '));
</script>

<svelte:window {onkeydown} />

<PageHeader
	title={project.name}
	subtitle={committeeNames || 'No committee owns this yet'}
	sticky={false}
>
	<Button variant="default" href={resolve(`/staff/projects/${project.id}/budget`)}>Budget</Button>
	{#if dutyListOptions.length > 0}
		<Action
			action={applyDutyListToProjectForm}
			label="Apply duty list"
			variant="default"
			modalTitle="Apply a duty list to {project.name}"
			submitLabel="Apply"
			successToast="Tasks created"
		>
			{#snippet form()}
				<input {...applyFields.projectId.as('hidden', project.id)} />
				{#if project.startsAt}
					<Field
						field={applyFields.dutyListId}
						type="select"
						label="Duty list"
						options={dutyListOptions}
						description="Creates every task the list describes, timed from the project's start date, under the sections it names. Applying the same list twice is refused."
					/>
				{:else}
					<Alert type="warning">
						This project has no start date. Set one under Edit project before applying a duty list.
					</Alert>
				{/if}
			{/snippet}
		</Action>
	{/if}

	<Action
		action={updateProjectForm}
		label="Edit project"
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

	<details class="dropdown dropdown-end">
		<summary class="btn btn-square btn-ghost btn-sm" aria-label="More project actions">
			<IconDots size={16} />
		</summary>
		<div class="dropdown-content dropdown-panel flex w-60 flex-col gap-1">
			{#if isProjectArchived(project.status)}
				<Action
					action={setProjectStatusForm}
					label="Unarchive"
					variant="ghost"
					class="justify-start"
					modalTitle="Unarchive project"
					successToast="Project unarchived"
				>
					{#snippet form()}
						<input {...statusFields.id.as('hidden', project.id)} />
						<input {...statusFields.status.as('hidden', PROJECT_UNARCHIVED_STATUS)} />
						<p class="text-sm">It returns to the active list with its tasks as they are.</p>
					{/snippet}
				</Action>
			{:else}
				<Action
					action={setProjectStatusForm}
					label="Archive"
					variant="ghost"
					class="justify-start"
					modalTitle="Archive project"
					successToast="Project archived"
				>
					{#snippet form()}
						<input {...statusFields.id.as('hidden', project.id)} />
						<Field
							field={statusFields.status}
							type="select"
							label="Outcome"
							options={projectArchiveOutcomeOptions}
							value="done"
							description={project.suggestionId
								? 'The suggestion this answers reports the same outcome.'
								: undefined}
						/>
					{/snippet}
				</Action>
			{/if}
			{#if data.canCreateBallot}
				<CreateBallotAction
					kind="member"
					panel="staff"
					decides={{ projectId: project.id, title: project.name }}
				/>
			{/if}
		</div>
	</details>
</PageHeader>

<PageContent>
	<div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" aria-label="Project status">
		{#if isProjectArchived(project.status)}
			<Badge variant="ghost">Archived</Badge>
		{/if}
		<span class="inline-flex items-center gap-2">
			<progress
				class="progress w-28 progress-success"
				value={progress.done}
				max={Math.max(progress.total, 1)}
				aria-label="Tasks done"
			></progress>
			<span class="inline-flex items-center gap-1">
				<strong>{progress.done}</strong> of {progress.total}
				<IconCheck size={14} aria-label="tasks done" />
			</span>
		</span>
		<span class="text-muted">
			{#if project.startsAt}
				{formatDateShort(project.startsAt)}{project.endsAt
					? ` – ${formatDateShort(project.endsAt)}`
					: ' onward'}
			{:else}
				No dates set
			{/if}
		</span>
	</div>

	<details class="collapse-arrow collapse border border-base-300">
		<summary class="collapse-title font-medium">About</summary>
		<div class="collapse-content space-y-4 text-sm">
			{#if project.description}
				<p class="whitespace-pre-wrap">{project.description}</p>
			{:else}
				<p class="text-muted">No description yet. Add one under Edit project.</p>
			{/if}
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
				{#if !origin.suggestion && !origin.ballot && origin.decidedBy.length === 0}
					<Fact label="Origin">Staff started this directly.</Fact>
				{/if}
				{#if data.attachments.events.length > 0}
					<Fact label="Events">
						<span class="flex flex-wrap gap-2">
							{#each data.attachments.events as ev (ev.id)}
								<EntityChip ref={ev.ref} />
							{/each}
						</span>
					</Fact>
				{/if}
			</DefinitionList>
		</div>
	</details>

	<div class="flex flex-col items-stretch lg:flex-row lg:items-start">
		<div class="@container min-w-0 flex-1 space-y-4">
			<TaskList
				{list}
				viewerId={data.viewerId}
				selectedId={selected?.id ?? null}
				{filter}
				{showDone}
				projectId={project.id}
				onopen={openTask}
				onfilter={(f) => {
					filter = f;
					setParams({ show: f === 'all' ? null : f });
				}}
				onshowdone={(show) => {
					showDone = show;
					setParams({ done: show ? null : 'hide' });
				}}
			/>
		</div>
		{#if selected}
			<aside class="task-panel" aria-labelledby="task-panel-title">
				<TaskPanel
					task={selected}
					{list}
					projectId={project.id}
					onclose={closeTask}
					onopen={openTask}
				/>
			</aside>
		{:else if selectedId}
			<Alert type="warning" class="ml-4">
				That task is not on this project.
				{#snippet action()}
					<Button size="sm" onclick={closeTask}>Close</Button>
				{/snippet}
			</Alert>
		{:else}
			<!-- With no task open, the sidebar is the project's activity. -->
			<aside class="activity-panel">
				<ActivityCard
					query={(limit) =>
						getProjectActivity(
							limit ? { projectId: project.id, limit } : { projectId: project.id }
						)}
					projectId={project.id}
				/>
			</aside>
		{/if}
	</div>
</PageContent>

<style>
	/* A sheet over the list on a phone; full height beside it from lg. */
	.task-panel {
		position: fixed;
		inset: 0;
		z-index: 900;
		overflow-y: auto;
		background: var(--color-base-100);
	}
	@media (width >= 64rem) {
		.task-panel {
			position: sticky;
			top: 4rem;
			z-index: auto;
			flex-shrink: 0;
			width: 20rem;
			max-height: calc(100dvh - 5rem);
			margin-left: 1rem;
			border-left: 1px solid var(--color-base-300);
		}
	}
	@media (width >= 80rem) {
		.task-panel {
			width: 24rem;
		}
	}

	/* Below the list on a phone; the same sticky sidebar slot as a task from lg. */
	.activity-panel {
		margin-top: 1rem;
	}
	@media (width >= 64rem) {
		.activity-panel {
			position: sticky;
			top: 1rem;
			flex-shrink: 0;
			width: 20rem;
			max-height: calc(100dvh - 5rem);
			overflow-y: auto;
			margin-top: 0;
			margin-left: 1rem;
		}
	}
	@media (width >= 80rem) {
		.activity-panel {
			width: 24rem;
		}
	}
</style>
