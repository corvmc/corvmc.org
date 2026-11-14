<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * A task this member may act on (#2582, #2989): its notes, due date and
	 * checklist. Authorisation is `canActOnTask`, checked in `getMyTask` and
	 * again in every write.
	 */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import TaskActReason from '#lib/components/task/TaskActReason.svelte';
	import { formatDateLong, formatDateShort } from '#lib/utils/format.js';
	import {
		getMyTask,
		handBackTask,
		markMyTaskDone,
		setMyTaskItemDone,
		takeTask
	} from '#lib/remote/volunteer.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';
	import { shiftLabel, shiftRoleSuffix } from '#lib/utils/shift-label.js';

	const params = routeParams('workOrderId');

	const workOrderId = $derived(params.workOrderId);
	const task = $derived(await getMyTask(workOrderId));

	const doneCount = $derived(task.items.filter((i) => i.done).length);
</script>

<PageHeader
	width="2xl"
	title={shiftLabel(task)}
	subtitle={shiftRoleSuffix(task) ?? task.eventTitle ?? m.member_volunteer_tasks_subtitle_body()}
>
	{#if task.canTake}
		<Action
			action={takeTask.for(task.workOrderId)}
			label={m.member_volunteer_tasks_assign_to_me_label()}
			variant="ghost"
			successToast={m.member_volunteer_tasks_assigned_toast()}
		>
			{#snippet form()}
				<input
					{...takeTask.for(task.workOrderId).fields.workOrderId.as('hidden', task.workOrderId)}
				/>
			{/snippet}
		</Action>
	{/if}
	{#if task.canHandBack}
		<Action
			action={handBackTask.for(task.workOrderId)}
			label={m.member_volunteer_tasks_hand_back_label()}
			variant="ghost"
			modalTitle={m.member_volunteer_tasks_hand_back_title()}
			submitLabel={m.member_volunteer_tasks_hand_back_label()}
			successToast={m.member_volunteer_tasks_handed_back_toast()}
		>
			{#snippet form()}
				<input
					{...handBackTask.for(task.workOrderId).fields.workOrderId.as('hidden', task.workOrderId)}
				/>
				<p class="text-sm">{m.member_volunteer_tasks_hand_back_text()}</p>
			{/snippet}
		</Action>
	{/if}
	{#if task.canMarkDone}
		<Action
			action={markMyTaskDone.for(task.workOrderId)}
			label={m.member_volunteer_assigned_tasks_mark_done_label()}
			modalTitle={m.member_volunteer_assigned_tasks_mark_done_title()}
			submitLabel={m.member_volunteer_assigned_tasks_mark_done_label()}
			successToast={m.member_volunteer_assigned_tasks_marked_done_toast()}
		>
			{#snippet form()}
				<input
					{...markMyTaskDone
						.for(task.workOrderId)
						.fields.workOrderId.as('hidden', task.workOrderId)}
				/>
				<p class="text-sm">{m.member_volunteer_assigned_tasks_mark_done_text()}</p>
				{#if task.closesItself}
					<FormField
						field={markMyTaskDone.for(task.workOrderId).fields.reason}
						label={m.member_volunteer_tasks_reason_label()}
						type="textarea"
						required
					/>
				{/if}
			{/snippet}
		</Action>
	{/if}
</PageHeader>
<PageContent width="2xl">
	<InfoCard title={m.member_volunteer_tasks_details_title()}>
		<p class="font-medium">
			{#if task.resolvedAt}
				{m.member_volunteer_tasks_done_text({ formatDateShort: formatDateShort(task.resolvedAt) })}
			{:else if task.dueAt}
				{m.member_volunteer_tasks_due_text({ formatDateLong: formatDateLong(task.dueAt) })}
			{:else}
				{m.member_volunteer_tasks_no_due_text()}
			{/if}
		</p>
		{#if task.notes}
			<p class="mt-2 text-muted whitespace-pre-line">{task.notes}</p>
		{/if}
		{#if task.why}
			<div class="mt-2"><TaskActReason why={task.why} /></div>
		{/if}
	</InfoCard>

	<InfoCard title={m.member_volunteer_tasks_checklist_title()} testid="task-checklist">
		{#snippet header(title)}
			<CardTitle>
				{title}
				{#if task.items.length > 0}
					<span class="text-muted font-normal"
						>{m.member_volunteer_tasks_checklist_count_title({
							done: doneCount,
							total: task.items.length
						})}</span
					>
				{/if}
			</CardTitle>
		{/snippet}

		{#if task.items.length === 0}
			<EmptyState message={m.member_volunteer_tasks_checklist_empty_body()} />
		{:else}
			<!-- Ticking submits on change: a checklist behind a Save button is a
			     checklist people forget to save. -->
			<ul class="flex flex-col gap-1">
				{#each task.items as item (item.id)}
					<li>
						<Form
							remote={setMyTaskItemDone.for(item.id)}
							onchange={(e: Event) => (e.currentTarget as HTMLFormElement).requestSubmit()}
						>
							<input
								{...setMyTaskItemDone.for(item.id).fields.workOrderId.as('hidden', workOrderId)}
							/>
							<input {...setMyTaskItemDone.for(item.id).fields.itemId.as('hidden', item.id)} />
							<FormField
								field={setMyTaskItemDone.for(item.id).fields.done}
								type="checkbox"
								checkboxLabel={item.label}
								value={item.done}
								class={item.done ? 'text-subtle line-through' : ''}
							/>
						</Form>
					</li>
				{/each}
			</ul>
		{/if}
	</InfoCard>
</PageContent>
