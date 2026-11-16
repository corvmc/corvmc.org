<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** Adding and editing a person share every field; `value` pre-fills the edit. */
	import { Field } from '#lib/components/ui/Form/index.js';
	import type { addPerson, updatePerson } from '#lib/remote/contacts.remote.js';

	interface Value {
		name: string | null;
		role: string | null;
		email: string | null;
		phone: string | null;
		notes: string | null;
	}

	let {
		fields,
		value
	}: {
		fields: (typeof addPerson)['fields'] | (typeof updatePerson)['fields'];
		value?: Value;
	} = $props();
</script>

<Field field={fields.name} type="text" label={m.staff_name_label()} value={value?.name ?? ''} />
<Field
	field={fields.role}
	type="text"
	label={m.staff_contacts_job_title_label()}
	value={value?.role ?? ''}
/>
<Field field={fields.email} type="email" label={m.staff_email_label()} value={value?.email ?? ''} />
<Field field={fields.phone} type="tel" label={m.staff_phone_label()} value={value?.phone ?? ''} />
<Field
	field={fields.notes}
	type="textarea"
	label={m.staff_notes_label()}
	value={value?.notes ?? ''}
/>
