<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { Latest } from '#lib/latest.svelte.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { createCatalogueTaskForm, getRelatedTasks } from '#lib/remote/tasks.remote.js';
	import { CHIPS, byWhen, matchesChip, type Chip } from '#lib/utils/task-facts.js';
	import type { RelatedSubjectType, RelationKey } from '#lib/utils/related-tasks.js';
	import TaskRow from './TaskRow.svelte';

	/**
	 * The tasks related to one record (#2630), grouped by how they relate,
	 * closest first. The server's registry decides the relations; this card
	 * draws the Tasks table's rows and chips over them.
	 */
	let { subject }: { subject: { type: RelatedSubjectType; id: string } } = $props();

	let showDone = $state(false);
	let chip = $state<Chip | ''>('');
	// Pinned once, so "overdue" does not move while the page is open.
	const now = new Date();

	const args = $derived({ type: subject.type, id: subject.id, includeDone: showDone });
	const related = new Latest(() => getRelatedTasks(args));
	$effect(() => {
		if (related.error) throw related.error.e;
	});

	const RELATION_LABELS: Record<RelationKey, () => string> = {
		event: m.staff_related_tasks_event_label,
		show: m.staff_related_tasks_show_label,
		project: m.staff_related_tasks_project_label,
		group: m.staff_related_tasks_group_label,
		groupProjects: m.staff_related_tasks_group_projects_label,
		role: m.staff_related_tasks_role_label,
		recurringWork: m.staff_related_tasks_recurring_work_label
	};
	// The table's invoice chip is about money; this card counts the work.
	const CARD_CHIPS = CHIPS.filter((c) => c !== 'invoice');
	const CHIP_LABELS: Record<Chip, () => string> = {
		unassigned: m.staff_tasks_unassigned_label,
		overdue: m.staff_overdue_label,
		untimed: m.staff_tasks_no_time_label,
		invoice: m.staff_volunteer_schedule_awaiting_invoice_label
	};

	const viewAll = $derived(
		withQuery(
			resolve('/staff/tasks'),
			new URLSearchParams({
				about: `${subject.type}:${subject.id}`,
				...(showDone ? { done: '1' } : {})
			})
		)
	);

	const { fields } = createCatalogueTaskForm;
</script>

<!-- Null is a viewer who may read the record but not its tasks. -->
{#if related.current}
	<InfoCard title={m.staff_related_tasks_title()} testid="related-tasks">
		{#snippet header(title)}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				<div class="flex items-center gap-1">
					{#if related.current.groups.length > 0 || showDone}
						<Button
							variant="ghost"
							size="sm"
							aria-pressed={showDone}
							data-testid="related-tasks-done"
							onclick={() => (showDone = !showDone)}
						>
							{m.staff_related_tasks_show_done_label()}
						</Button>
						<Button variant="ghost" size="sm" href={viewAll}>
							{m.staff_related_tasks_view_all_label()}
						</Button>
					{/if}
					{#if related.current.prefill}
						{@const prefill = related.current.prefill}
						<Action
							action={createCatalogueTaskForm}
							label={m.staff_tasks_new_task_label()}
							modalTitle={m.staff_tasks_new_task_title()}
							successToast={m.staff_tasks_task_added_toast()}
							variant="ghost"
							size="sm"
							data-testid="related-new-task"
							onsuccess={(result) => {
								const id = (result as { id?: string } | undefined)?.id;
								if (id) void goto(resolve('/staff/tasks/[id]', { id }));
							}}
						>
							{#snippet form()}
								{#if prefill.projectId}
									<input {...fields.projectId.as('hidden', prefill.projectId)} />
								{/if}
								{#if prefill.eventId}
									<input {...fields.eventId.as('hidden', prefill.eventId)} />
								{/if}
								{#if prefill.groupId}
									<input {...fields.groupId.as('hidden', prefill.groupId)} />
								{/if}
								{#if prefill.volunteerRoleId}
									<input {...fields.volunteerRoleId.as('hidden', prefill.volunteerRoleId)} />
								{/if}
								<Field field={fields.title} type="text" label={m.staff_title_label()} />
								<Field field={fields.dueAt} type="date" label={m.staff_tasks_due_date_label()} />
							{/snippet}
						</Action>
					{/if}
				</div>
			</div>
		{/snippet}

		{#if related.current.groups.length > 0}
			{@const data = related.current}
			{@const marksOf = (id: string) => data.contractors[id] ?? []}
			{@const all = data.groups.flatMap((g) => g.tasks)}
			<div class="flex flex-wrap gap-2" data-testid="related-task-chips">
				{#each CARD_CHIPS as c (c)}
					{@const n = all.filter((t) => matchesChip(c, t, marksOf(t.id), now)).length}
					{#if n > 0 || chip === c}
						<Button
							size="sm"
							variant={chip === c ? 'primary' : 'ghost'}
							aria-pressed={chip === c}
							data-chip={c}
							onclick={() => (chip = chip === c ? '' : c)}
						>
							{CHIP_LABELS[c]()}
							<Badge size="sm">{n}</Badge>
						</Button>
					{/if}
				{/each}
			</div>

			<Table zebra={false} packed={false}>
				{#each data.groups as group (group.key)}
					{@const rows = group.tasks
						.filter((t) => !chip || matchesChip(chip, t, marksOf(t.id), now))
						.sort(byWhen)}
					{#if data.groups.length > 1 && rows.length > 0}
						<tr data-testid="related-task-group" data-relation={group.key}>
							<td colspan="4" class="cell-group">{RELATION_LABELS[group.key]()}</td>
						</tr>
					{/if}
					{#each rows as t (t.id)}
						<TaskRow task={t} marks={marksOf(t.id)} {now} compact />
					{/each}
				{/each}
			</Table>
		{/if}
	</InfoCard>
{/if}
