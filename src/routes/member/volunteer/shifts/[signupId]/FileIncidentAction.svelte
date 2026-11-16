<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { clubToday, incidentCategories, incidentCategoryLabels } from '#lib/config.js';
	import { fileShowIncidentForm } from '#lib/remote/incidents.remote.js';
	import { getMyShift } from '#lib/remote/volunteer.remote.js';

	let { eventId, signupId }: { eventId: string; signupId: string } = $props();

	const { fields } = fileShowIncidentForm;
	const categoryOptions = incidentCategories.map((c) => ({
		value: c,
		label: incidentCategoryLabels[c]
	}));
</script>

<Action
	action={fileShowIncidentForm}
	label={m.member_volunteer_shifts_signup_id_file_incident_report_incid_label()}
	modalTitle={m.member_volunteer_shifts_signup_id_file_incident_report_incid_title()}
	submitLabel={m.member_send_staff_label()}
	successToast={m.member_volunteer_shifts_signup_id_file_incident_success_toas_toast()}
	variant="default"
	size="sm"
	outline
	onsuccess={() => void getMyShift(signupId).refresh()}
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.occurredOn}
				type="date"
				label={m.member_date_label()}
				value={clubToday()}
			/>
			<Field field={fields.occurredAt} type="time" label={m.member_time_label()} />
		</div>
		<Field
			field={fields.category}
			type="select"
			label={m.member_volunteer_shifts_signup_id_file_incident_kind_label()}
			options={categoryOptions}
		/>
		<Field
			field={fields.summary}
			type="text"
			label={m.member_volunteer_shifts_signup_id_file_incident_summary_label()}
			description={m.member_volunteer_shifts_signup_id_file_incident_description_body()}
		/>
		<Field
			field={fields.description}
			type="textarea"
			label={m.member_volunteer_shifts_signup_id_file_incident_what_happene_label()}
		/>
		<Field
			field={fields.location}
			type="text"
			label={m.member_volunteer_shifts_signup_id_file_incident_where_label()}
		/>
		<p class="text-muted text-wrap">
			{m.member_volunteer_shifts_signup_id_file_incident_staff_review_text()}
		</p>
	{/snippet}
</Action>
