<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/** The add and edit forms share every field; `value` pre-fills the edit. */
	import { Field } from '$lib/components/ui/Form';
	import type { addGrantReport } from '$lib/remote/grants.remote';

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
	label={m.staff_report()}
	description={m.staff_grants_id_grant_report_fields_interim_report_final_rep()}
	value={value?.title ?? ''}
/>
<Field field={fields.dueOn} type="date" label={m.staff_due()} value={value?.dueOn ?? ''} />
<Field
	field={fields.submittedOn}
	type="date"
	label={m.staff_submitted()}
	description={m.staff_grants_id_grant_report_fields_blank_until_sent()}
	value={value?.submittedOn ?? ''}
/>
<Field field={fields.notes} type="textarea" label={m.staff_notes()} value={value?.notes ?? ''} />
