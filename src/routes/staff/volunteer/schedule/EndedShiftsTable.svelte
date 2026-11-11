<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Open tasks whose last shift has ended (#2518). Each gets the two answers:
	 * mark it done, which resolves its equipment reports and tells each reporter,
	 * or open another shift. The clock never closes a task.
	 */
	import Table from '#lib/components/ui/Table.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import OpenShiftAction from '#lib/components/volunteer/OpenShiftAction.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '#lib/utils/format.js';
	import { resolveWorkOrder } from '#lib/remote/volunteer.remote.js';
	import { NO_ROLE_LABEL } from '#lib/utils/shift-label.js';

	type EndedTask = {
		id: string;
		title: string | null;
		roleName: string | null;
		endsAt: Date;
		unitName: string | null;
		assetTag: string | null;
		reports: number;
	};

	let { tasks, onsuccess }: { tasks: EndedTask[]; onsuccess?: () => void } = $props();

	function subject(t: EndedTask): string {
		if (t.unitName) return t.assetTag ? `${t.unitName} (${t.assetTag})` : t.unitName;
		return t.title ?? t.roleName ?? NO_ROLE_LABEL;
	}
</script>

<Table>
	{#snippet head()}
		<th>{m.staff_volunteer_ended_shifts_task_label()}</th>
		<th class="col-support whitespace-nowrap"
			>{m.staff_volunteer_ended_shifts_last_shift_label()}</th
		>
		<th class="col-support cell-num whitespace-nowrap"
			>{m.staff_volunteer_ended_shifts_reports_label()}</th
		>
		<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
	{/snippet}

	{#each tasks as task (task.id)}
		{@const done = resolveWorkOrder.for(task.id)}
		<tr class="hover">
			<td class="cell-primary">
				<a href={resolve(`staff/volunteer/shifts/${task.id}`)} class="link font-medium">
					{subject(task)}
				</a>
				<div class="truncate text-subtle">{task.roleName ?? NO_ROLE_LABEL}</div>
			</td>
			<td class="col-support whitespace-nowrap">
				{formatDateShort(task.endsAt)}
			</td>
			<td class="col-support cell-num">{task.reports}</td>
			<td class="w-px">
				<div class="flex w-max justify-end gap-1">
					<Action
						action={done}
						label={m.staff_volunteer_mark_done_label()}
						data-testid="mark-done"
						variant="primary"
						size="xs"
						modalTitle={m.staff_volunteer_mark_done_title({ subject: subject(task) })}
						submitLabel={m.staff_volunteer_mark_done_label()}
						successToast={m.staff_volunteer_marked_done_toast()}
						{onsuccess}
					>
						{#snippet form()}
							<input {...done.fields.id.as('hidden', task.id)} />
							{#if task.reports > 0}
								<p class="text-sm">
									{m.staff_volunteer_mark_done_closes_reports_text({ reports: task.reports })}
								</p>
							{/if}
							<FormField
								field={done.fields.notes}
								label={m.staff_volunteer_work_done_label()}
								type="textarea"
							/>
						{/snippet}
					</Action>
					<OpenShiftAction taskId={task.id} label={subject(task)} variant="ghost" {onsuccess} />
				</div>
			</td>
		</tr>
	{/each}
</Table>
