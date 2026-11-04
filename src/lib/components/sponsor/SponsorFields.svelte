<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field } from '#lib/components/ui/Form/index.js';
	import type { createSponsor } from '#lib/remote/sponsors.remote.js';

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
		fields: (typeof createSponsor)['fields'];
		value?: Value;
	} = $props();
</script>

<Field
	field={fields.name}
	type="text"
	label={m.sponsor_sponsor_fields_business()}
	value={value?.name ?? ''}
/>
<Field
	field={fields.website}
	type="text"
	label={m.sponsor_sponsor_fields_website()}
	value={value?.website ?? ''}
/>
<Field
	field={fields.contactName}
	type="text"
	label={m.sponsor_sponsor_fields_contact()}
	value={value?.contactName ?? ''}
/>
<Field
	field={fields.contactEmail}
	type="email"
	label={m.sponsor_sponsor_fields_contact_email()}
	value={value?.contactEmail ?? ''}
/>
<Field
	field={fields.notes}
	type="textarea"
	label={m.sponsor_sponsor_fields_notes()}
	value={value?.notes ?? ''}
/>
