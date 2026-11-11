<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * A task with no shift has two answers: open a shift on it, which puts it on
	 * the volunteer board, or mark it done, which resolves its equipment reports.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import OpenShiftAction from '#lib/components/volunteer/OpenShiftAction.svelte';
	import { IconCheck } from '@tabler/icons-svelte';
	import { resolveWorkOrder } from '#lib/remote/volunteer.remote.js';

	let {
		order,
		label,
		onsuccess
	}: {
		order: { id: string; dueAt: Date | null; pendingCapacity: number | null };
		label: string;
		onsuccess?: () => void;
	} = $props();

	const done = $derived(resolveWorkOrder.for(order.id));
</script>

<OpenShiftAction
	taskId={order.id}
	{label}
	start={order.dueAt}
	capacity={order.pendingCapacity ?? 1}
	{onsuccess}
/>

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
		<input {...done.fields.id.as('hidden', order.id)} />
		<FormField
			field={done.fields.notes}
			label={m.staff_volunteer_work_done_label()}
			type="textarea"
		/>
	{/snippet}
</Action>

{#snippet doneIcon()}
	<IconCheck size={16} />
{/snippet}
