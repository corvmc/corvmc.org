<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Open a shift on a task: a time, places and a briefing. Creating it is what
	 * puts it on the volunteer board (#2518). Shared by the task page, Today's
	 * ended-shift rows and the Schedule's rows with no shift.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import type { ButtonSize, ButtonVariant } from '#lib/components/ui/Button.svelte';
	import { toLocalDateTime } from '#lib/utils/format.js';
	import { VOLUNTEER_SHIFT_NOTES_MAX } from '#lib/config.js';
	import { openShift } from '#lib/remote/volunteer.remote.js';

	let {
		taskId,
		label,
		start = null,
		capacity = 1,
		variant = 'primary',
		size = 'xs',
		onsuccess
	}: {
		taskId: string;
		/** The task's name, for the modal title. */
		label: string;
		/** Where the times start out: a deadline, else tomorrow. */
		start?: Date | null;
		capacity?: number;
		variant?: ButtonVariant;
		size?: ButtonSize;
		onsuccess?: () => void;
	} = $props();

	const open = $derived(openShift.for(taskId));
	const from = $derived(start ?? new Date(Date.now() + 86_400_000));
</script>

<Action
	action={open}
	label={m.volunteer_open_shift_label()}
	{variant}
	{size}
	modalTitle={m.volunteer_open_shift_title({ task: label })}
	submitLabel={m.volunteer_open_shift_label()}
	successToast={m.volunteer_open_shift_toast()}
	{onsuccess}
	data-testid="open-shift"
>
	{#snippet form()}
		<input {...open.fields.id.as('hidden', taskId)} />
		<FormField
			field={open.fields.startsAt}
			label={m.volunteer_shift_form_fields_starts_label()}
			type="datetime-local"
			value={toLocalDateTime(from)}
		/>
		<FormField
			field={open.fields.endsAt}
			label={m.volunteer_shift_form_fields_ends_label()}
			type="datetime-local"
			value={toLocalDateTime(new Date(from.getTime() + 2 * 3_600_000))}
		/>
		<FormField
			field={open.fields.capacity}
			submitAs="text"
			label={m.volunteer_shift_form_fields_people_needed_label()}
			type="number"
			min="1"
			value={String(capacity)}
		/>
		<FormField
			field={open.fields.notes}
			label={m.volunteer_shift_form_fields_anything_they_should_know_label()}
			type="textarea"
			description={m.volunteer_shift_form_fields_where_meet_what_bring_shown_body({
				VOLUNTEER_SHIFT_NOTES_MAX
			})}
		/>
	{/snippet}
</Action>
