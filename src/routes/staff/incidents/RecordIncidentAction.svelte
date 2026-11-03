<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '$lib/components/ui/Action.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { clubToday, incidentCategories, incidentCategoryLabels } from '$lib/config';
	import { recordIncidentForm } from '$lib/remote/incidents.remote';

	const { fields } = recordIncidentForm;
	const categoryOptions = incidentCategories.map((c) => ({
		value: c,
		label: incidentCategoryLabels[c]
	}));

	let involvedUserId = $state('');
	let involvedName = $state('');
</script>

<Action
	action={recordIncidentForm}
	label={m.staff_incidents_record_incident_record_incident()}
	modalTitle={m.staff_incidents_record_incident_modal_title()}
	submitLabel={m.staff_record()}
	successToast={m.staff_incidents_record_incident_success_toast()}
	onsuccess={(result) => {
		involvedUserId = '';
		involvedName = '';
		const id = (result as { id?: string } | undefined)?.id;
		if (id) void goto(resolve(`/staff/incidents/${id}`));
	}}
>
	{#snippet form()}
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.occurredOn} type="date" label={m.staff_date()} value={clubToday()} />
			<Field field={fields.occurredAt} type="time" label={m.staff_time()} />
		</div>
		<Field field={fields.category} type="select" label={m.staff_kind()} options={categoryOptions} />
		<Field
			field={fields.summary}
			type="text"
			label={m.staff_summary()}
			description={m.staff_incidents_record_incident_one_line_what_log_shows()}
		/>
		<Field
			field={fields.description}
			type="textarea"
			label={m.staff_what_happened()}
			description={m.staff_incidents_record_incident_written_once_anything_learne()}
		/>
		<Field field={fields.location} type="text" label={m.staff_where()} />
		<MemberPicker
			field={fields.involvedUserId}
			label={m.staff_incidents_record_incident_member_involved_optional()}
			bind:value={involvedUserId}
			bind:name={involvedName}
		/>
		<p class="text-muted text-wrap">
			{m.staff_incidents_record_incident_recording_changes_nothing_ab()}
		</p>
	{/snippet}
</Action>
