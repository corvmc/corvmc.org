<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * What a row of open work offers: a shift, which opens volunteer work to
	 * sign-ups; Assign, which opens the task at its picker; and Mark done.
	 * Engaging a contractor is on the task's page.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import OpenShiftAction from '#lib/components/volunteer/OpenShiftAction.svelte';
	import { IconCheck } from '@tabler/icons-svelte';
	import { resolveWorkOrder } from '#lib/remote/volunteer.remote.js';

	let {
		task,
		label,
		href,
		unassigned,
		onsuccess
	}: {
		task: {
			id: string;
			volunteerRoleId: string | null;
			dueAt: Date | null;
			pendingCapacity: number | null;
			shifts: number;
		};
		label: string;
		href: string;
		unassigned: boolean;
		onsuccess?: () => void;
	} = $props();

	const done = $derived(resolveWorkOrder.for(task.id));
</script>

<div class="flex w-max justify-end gap-1">
	{#if task.volunteerRoleId && task.shifts === 0}
		<OpenShiftAction
			taskId={task.id}
			{label}
			start={task.dueAt}
			capacity={task.pendingCapacity ?? 1}
			variant="ghost"
			{onsuccess}
		/>
	{/if}
	{#if unassigned}
		<Button {href} variant="ghost" size="xs">{m.staff_assign_label()}</Button>
	{/if}
	<Action
		action={done}
		label={m.staff_volunteer_mark_done_label()}
		iconOnly
		icon={doneIcon}
		variant="ghost"
		size="xs"
		modalTitle={m.staff_volunteer_mark_done_title({ subject: label })}
		submitLabel={m.staff_volunteer_mark_done_label()}
		successToast={m.staff_volunteer_marked_done_toast()}
		{onsuccess}
	>
		{#snippet form()}
			<input {...done.fields.id.as('hidden', task.id)} />
			<FormField
				field={done.fields.notes}
				label={m.staff_volunteer_work_done_label()}
				type="textarea"
			/>
		{/snippet}
	</Action>
</div>

{#snippet doneIcon()}
	<IconCheck size={16} />
{/snippet}
