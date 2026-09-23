<script lang="ts">
	import { Field } from '$lib/components/ui/Form';
	import type { RemoteFormField, RemoteFormFieldValue } from '@sveltejs/kit';

	/**
	 * The listing fields, shared by create and edit so the two forms cannot drift.
	 * Contact details are public on purpose: they are the point of the listing.
	 */
	type F = RemoteFormField<RemoteFormFieldValue>;
	let {
		fields,
		categories,
		values = {}
	}: {
		fields: {
			categoryId: F;
			name: F;
			description: F;
			website: F;
			phone: F;
			// Spelled out so form-coverage.spec can see the control; an alias hides it.
			addressLine: RemoteFormField<RemoteFormFieldValue>;
		};
		categories: { id: string; name: string }[];
		values?: {
			categoryId?: string;
			name?: string;
			description?: string | null;
			website?: string | null;
			phone?: string | null;
			addressLine?: string | null;
		};
	} = $props();

	const options = $derived(categories.map((c) => ({ value: c.id, label: c.name })));
</script>

<Field
	field={fields.categoryId}
	type="select"
	label="Category"
	{options}
	value={values.categoryId ?? ''}
/>
<Field field={fields.name} type="text" label="Name" value={values.name ?? ''} />
<Field
	field={fields.description}
	type="textarea"
	label="Description"
	description="A sentence or two — what they are and why they are worth knowing."
	value={values.description ?? ''}
/>
<Field field={fields.website} type="text" label="Website" value={values.website ?? ''} />
<Field field={fields.phone} type="tel" label="Phone" value={values.phone ?? ''} />
<Field field={fields.addressLine} type="text" label="Address" value={values.addressLine ?? ''} />
<p class="text-muted text-wrap">Everything here is shown publicly on /local-resources.</p>
