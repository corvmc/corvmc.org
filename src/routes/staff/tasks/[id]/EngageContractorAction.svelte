<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import { createJobForm } from '#lib/remote/contractors.remote.js';

	/**
	 * Engages a contractor on this task; a project's task has its own picker.
	 * With people assigned or signed up for its shifts still to come, the first
	 * submit says how many; the second takes them off and calls those shifts off.
	 */
	let {
		workOrderId,
		contractors
	}: { workOrderId: string; contractors: { id: string; name: string }[] } = $props();

	const { fields } = createJobForm;
	const options = $derived(contractors.map((c) => ({ value: c.id, label: c.name })));
	const warning = $derived(
		createJobForm.result?.status === 'needs_confirmation' ? createJobForm.result.people : 0
	);
</script>

<Action
	action={createJobForm}
	label={m.staff_engage_contractor_label()}
	variant="ghost"
	size="sm"
	modalTitle={m.staff_engage_contractor_title()}
	submitLabel={warning > 0
		? m.staff_projects_id_assign_picker_body_engage_cancel_signups_label()
		: m.staff_engage_contractor_label()}
	successToast={m.staff_volunteer_shifts_id_engage_contractor_success_toast()}
	data-testid="engage-contractor"
>
	{#snippet form()}
		<input {...createJobForm.fields.workOrderId.as('hidden', workOrderId)} />
		<Field field={fields.contractorId} type="select" label={m.staff_contractor_label()} {options} />
		<Field
			field={fields.scheduledFor}
			type="date"
			label={m.staff_volunteer_shifts_id_engage_contractor_when_they_come_label()}
		/>
		<Field
			field={fields.expectedBackAt}
			type="date"
			label={m.staff_volunteer_shifts_id_engage_contractor_promised_back_label()}
		/>
		<MoneyField field={fields.quotedCents} label={m.staff_quoted_label()} />
		<Field field={fields.notes} type="textarea" label={m.staff_notes_label()} />
		{#if warning > 0}
			<input {...createJobForm.fields.confirm.as('hidden', true)} />
			<Alert type="warning" class="text-sm">
				{m.staff_projects_id_assign_picker_engage_warning_body({ count: warning })}
			</Alert>
		{/if}
	{/snippet}
</Action>
