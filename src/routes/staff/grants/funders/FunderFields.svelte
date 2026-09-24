<script lang="ts">
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field } from '$lib/components/ui/Form';
	import type { createFunder, updateFunder } from '$lib/remote/grants.remote';

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

<Field field={fields.name} type="text" label="Funder" value={value?.name ?? ''} />
<Field field={fields.website} type="text" label="Website" value={value?.website ?? ''} />
<Field
	field={fields.contactName}
	type="text"
	label="Program officer"
	value={value?.contactName ?? ''}
/>
<Field
	field={fields.contactEmail}
	type="email"
	label="Contact email"
	value={value?.contactEmail ?? ''}
/>
<Field field={fields.notes} type="textarea" label="Notes" value={value?.notes ?? ''} />
