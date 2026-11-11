<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** The add and edit forms share every field; `value` pre-fills the edit. */
	import { Field } from '#lib/components/ui/Form/index.js';
	import type { addGrantReport } from '#lib/remote/grants.remote.js';

	interface Value {
		title: string;
		dueOn: string;
		submittedOn: string | null;
		notes: string | null;
	}

	let {
		fields,
		value
	}: {
		fields: (typeof addGrantReport)['fields'];
		value?: Value;
	} = $props();
</script>

<Field
	field={fields.title}
	type="text"
	label={m.staff_report_label()}
	description={m.staff_grants_id_grant_report_fields_interim_report_final_rep_body()}
	value={value?.title ?? ''}
/>
<Field field={fields.dueOn} type="date" label={m.staff_due_label()} value={value?.dueOn ?? ''} />
<Field
	field={fields.submittedOn}
	type="date"
	label={m.staff_submitted_label()}
	description={m.staff_grants_id_grant_report_fields_blank_until_sent_body()}
	value={value?.submittedOn ?? ''}
/>
<Field
	field={fields.notes}
	type="textarea"
	label={m.staff_notes_label()}
	value={value?.notes ?? ''}
/>
