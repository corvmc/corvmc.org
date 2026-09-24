<script lang="ts">
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field } from '$lib/components/ui/Form';
	import type { createSponsor } from '$lib/remote/sponsors.remote';

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

<Field field={fields.name} type="text" label="Business" value={value?.name ?? ''} />
<Field field={fields.website} type="text" label="Website" value={value?.website ?? ''} />
<Field field={fields.contactName} type="text" label="Contact" value={value?.contactName ?? ''} />
<Field
	field={fields.contactEmail}
	type="email"
	label="Contact email"
	value={value?.contactEmail ?? ''}
/>
<Field field={fields.notes} type="textarea" label="Notes" value={value?.notes ?? ''} />
