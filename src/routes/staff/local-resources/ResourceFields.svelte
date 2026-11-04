<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { Field } from '#lib/components/ui/Form/index.js';
	import type { RemoteFormField, RemoteFormFieldValue } from '$app/server';

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
			displayOrder: RemoteFormField<RemoteFormFieldValue>;
		};
		categories: { id: string; name: string }[];
		values?: {
			categoryId?: string;
			name?: string;
			description?: string | null;
			website?: string | null;
			phone?: string | null;
			addressLine?: string | null;
			displayOrder?: number;
		};
	} = $props();

	const options = $derived(categories.map((c) => ({ value: c.id, label: c.name })));
</script>

<Field
	field={fields.categoryId}
	type="select"
	label={m.staff_category()}
	{options}
	value={values.categoryId ?? ''}
/>
<Field field={fields.name} type="text" label={m.staff_name()} value={values.name ?? ''} />
<Field
	field={fields.description}
	type="textarea"
	label={m.staff_description()}
	description={m.staff_local_resources_resource_fields_description()}
	value={values.description ?? ''}
/>
<Field field={fields.website} type="text" label={m.staff_website()} value={values.website ?? ''} />
<Field field={fields.phone} type="tel" label={m.staff_phone()} value={values.phone ?? ''} />
<Field
	field={fields.addressLine}
	type="text"
	label={m.staff_address()}
	value={values.addressLine ?? ''}
/>
<Field
	field={fields.displayOrder}
	type="number"
	label={m.staff_order_2()}
	value={values.displayOrder ?? 0}
	min="0"
/>
<p class="text-muted text-wrap">
	{m.staff_local_resources_resource_fields_everything_here_shown()}
</p>
