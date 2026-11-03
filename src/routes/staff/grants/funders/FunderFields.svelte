<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field } from '#lib/components/ui/Form/index.js';
	import type { createFunder, updateFunder } from '#lib/remote/grants.remote.js';

	interface Value {
		name: string;
		website: string | null;
		contactName: string | null;
		contactEmail: string | null;
		notes: string | null;
	}

	let {
		fields,
		value
	}: {
		fields: (typeof createFunder)['fields'] | (typeof updateFunder)['fields'];
		value?: Value;
	} = $props();
</script>

<Field field={fields.name} type="text" label={m.staff_funder()} value={value?.name ?? ''} />
<Field field={fields.website} type="text" label={m.staff_website()} value={value?.website ?? ''} />
<Field
	field={fields.contactName}
	type="text"
	label={m.staff_grants_funders_funder_fields_program_officer()}
	value={value?.contactName ?? ''}
/>
<Field
	field={fields.contactEmail}
	type="email"
	label={m.staff_contact_email()}
	value={value?.contactEmail ?? ''}
/>
<Field field={fields.notes} type="textarea" label={m.staff_notes()} value={value?.notes ?? ''} />
