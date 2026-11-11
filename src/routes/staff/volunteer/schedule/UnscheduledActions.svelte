<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * A task with no shift has two answers: open a shift on it, which puts it on
	 * the volunteer board, or mark it done, which resolves its equipment reports.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { IconCheck } from '@tabler/icons-svelte';
	import { toLocalDateTime } from '#lib/utils/format.js';
	import { openShift, resolveWorkOrder } from '#lib/remote/volunteer.remote.js';

	let {
		order,
		label,
		onsuccess
	}: {
		order: { id: string; dueAt: Date | null };
		label: string;
		onsuccess?: () => void;
	} = $props();

	// The deadline itself where there is one, otherwise tomorrow.
	const start = $derived(order.dueAt ?? new Date(Date.now() + 86_400_000));
</script>

<Action
	action={openShift.for(order.id)}
	label={m.staff_schedule_label()}
	variant="primary"
	size="xs"
	modalTitle={m.staff_volunteer_needs_scheduling_card_find_time_title({ value: label })}
	submitLabel={m.staff_schedule_label()}
	successToast={m.staff_scheduled_toast()}
	{onsuccess}
>
	{#snippet form()}
		<input {...openShift.for(order.id).fields.id.as('hidden', order.id)} />
		<p class="text-sm">
			{m.staff_volunteer_needs_scheduling_card_once_has_window_appear_text()}
		</p>
		<FormField
			field={openShift.for(order.id).fields.startsAt}
			label={m.staff_starts_label()}
			type="datetime-local"
			value={toLocalDateTime(start)}
		/>
		<FormField
			field={openShift.for(order.id).fields.endsAt}
			label={m.staff_ends_label()}
			type="datetime-local"
			value={toLocalDateTime(new Date(start.getTime() + 2 * 3_600_000))}
		/>
	{/snippet}
</Action>

<Action
	action={resolveWorkOrder.for(order.id)}
	label={m.staff_volunteer_needs_scheduling_card_close_work_order_label()}
	iconOnly
	icon={doneIcon}
	variant="ghost"
	size="xs"
	modalTitle={m.staff_volunteer_needs_scheduling_card_close_title({ value: label })}
	submitLabel={m.staff_volunteer_needs_scheduling_card_close_work_order_label()}
	successToast={m.staff_closed_toast()}
	{onsuccess}
>
	{#snippet form()}
		<input {...resolveWorkOrder.for(order.id).fields.id.as('hidden', order.id)} />
		<p class="text-sm">
			{m.staff_volunteer_needs_scheduling_card_says_work_finished_whi_text()}
		</p>
		<FormField
			field={resolveWorkOrder.for(order.id).fields.notes}
			label={m.staff_what_happened_label()}
			type="textarea"
		/>
	{/snippet}
</Action>

{#snippet doneIcon()}
	<IconCheck size={16} />
{/snippet}
