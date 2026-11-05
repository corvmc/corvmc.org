<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * A work order with no window has two answers, matching the service: schedule
	 * it, which makes it an ordinary claimable shift, or close it, which completes
	 * its signups itself — the completion cron keys on `ends_at` and never reaches it.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { IconCheck } from '@tabler/icons-svelte';
	import { toLocalDateTime } from '#lib/utils/format.js';
	import { scheduleWorkOrder, resolveWorkOrder } from '#lib/remote/volunteer.remote.js';

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
	action={scheduleWorkOrder.for(order.id)}
	label={m.staff_schedule()}
	variant="primary"
	size="xs"
	modalTitle={m.staff_volunteer_needs_scheduling_card_find_time({ value: label })}
	submitLabel={m.staff_schedule()}
	successToast={m.staff_scheduled()}
	{onsuccess}
>
	{#snippet form()}
		<input {...scheduleWorkOrder.for(order.id).fields.id.as('hidden', order.id)} />
		<p class="text-sm">
			{m.staff_volunteer_needs_scheduling_card_once_has_window_appear()}
		</p>
		<FormField
			field={scheduleWorkOrder.for(order.id).fields.startsAt}
			label={m.staff_starts()}
			type="datetime-local"
			value={toLocalDateTime(start)}
		/>
		<FormField
			field={scheduleWorkOrder.for(order.id).fields.endsAt}
			label={m.staff_ends()}
			type="datetime-local"
			value={toLocalDateTime(new Date(start.getTime() + 2 * 3_600_000))}
		/>
		<FormField
			field={scheduleWorkOrder.for(order.id).fields.closeReportsOnCompletion}
			type="checkbox"
			checkboxLabel={m.staff_volunteer_needs_scheduling_card_checkbox_label()}
			description={m.staff_volunteer_needs_scheduling_card_description()}
		/>
	{/snippet}
</Action>

<Action
	action={resolveWorkOrder.for(order.id)}
	label={m.staff_volunteer_needs_scheduling_card_close_work_order()}
	iconOnly
	icon={doneIcon}
	variant="ghost"
	size="xs"
	modalTitle={m.staff_volunteer_needs_scheduling_card_close({ value: label })}
	submitLabel={m.staff_volunteer_needs_scheduling_card_close_work_order()}
	successToast={m.staff_closed()}
	{onsuccess}
>
	{#snippet form()}
		<input {...resolveWorkOrder.for(order.id).fields.id.as('hidden', order.id)} />
		<p class="text-sm">
			{m.staff_volunteer_needs_scheduling_card_says_work_finished_whi()}
		</p>
		<FormField
			field={resolveWorkOrder.for(order.id).fields.notes}
			label={m.staff_what_happened()}
			type="textarea"
		/>
	{/snippet}
</Action>

{#snippet doneIcon()}
	<IconCheck size={16} />
{/snippet}
