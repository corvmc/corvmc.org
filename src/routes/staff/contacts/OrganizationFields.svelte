<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field } from '#lib/components/ui/Form/index.js';
	import type { createOrganization, updateOrganization } from '#lib/remote/contacts.remote.js';

	interface Value {
		name: string;
		website: string | null;
		notes: string | null;
	}

	let {
		fields,
		value
	}: {
		fields: (typeof createOrganization)['fields'] | (typeof updateOrganization)['fields'];
		value?: Value;
	} = $props();
</script>

<Field field={fields.name} type="text" label={m.staff_name_label()} value={value?.name ?? ''} />
<Field
	field={fields.website}
	type="text"
	label={m.staff_website_label()}
	value={value?.website ?? ''}
/>
<Field
	field={fields.notes}
	type="textarea"
	label={m.staff_notes_label()}
	value={value?.notes ?? ''}
/>
