<script lang="ts">
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
	label="Report"
	description="“Interim report”, “Final report”."
	value={value?.title ?? ''}
/>
<Field field={fields.dueOn} type="date" label="Due" value={value?.dueOn ?? ''} />
<Field
	field={fields.submittedOn}
	type="date"
	label="Submitted"
	description="Blank until it is sent."
	value={value?.submittedOn ?? ''}
/>
<Field field={fields.notes} type="textarea" label="Notes" value={value?.notes ?? ''} />
