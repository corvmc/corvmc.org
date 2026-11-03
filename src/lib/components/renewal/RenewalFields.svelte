<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field } from '$lib/components/ui/Form';
	import type { createRenewal } from '$lib/remote/renewals.remote';
	import { renewalKinds, renewalKindLabels, type RenewalKind } from '$lib/config';

	interface Value {
		name: string;
		kind: RenewalKind;
		issuer: string | null;
		reference: string | null;
		expiresOn: string;
		responsibleUserId: string | null;
		notes: string | null;
	}

	let {
		fields,
		assignees,
		value
	}: {
		fields: (typeof createRenewal)['fields'];
		assignees: { id: string; name: string }[];
		value?: Value;
	} = $props();

	const kindOptions = renewalKinds.map((k) => ({ value: k, label: renewalKindLabels[k] }));
	const assigneeOptions = $derived(assignees.map((u) => ({ value: u.id, label: u.name })));
</script>

<Field
	field={fields.name}
	type="text"
	label={m.renewal_renewal_fields_name()}
	description={m.renewal_renewal_fields_general_liability_insurance_olcc_spec()}
	value={value?.name ?? ''}
/>
<Field
	field={fields.kind}
	type="select"
	label={m.renewal_renewal_fields_kind()}
	options={kindOptions}
	value={value?.kind ?? 'permit'}
/>
<Field
	field={fields.issuer}
	type="text"
	label={m.renewal_renewal_fields_issued_by()}
	description={m.renewal_renewal_fields_city_olcc_insurer()}
	value={value?.issuer ?? ''}
/>
<Field
	field={fields.reference}
	type="text"
	label={m.renewal_renewal_fields_reference()}
	description={m.renewal_renewal_fields_permit_license_policy_number()}
	value={value?.reference ?? ''}
/>
<Field
	field={fields.expiresOn}
	type="date"
	label={m.renewal_renewal_fields_expires()}
	value={value?.expiresOn ?? ''}
/>
<Field
	field={fields.responsibleUserId}
	type="select"
	label={m.renewal_renewal_fields_responsible()}
	description={m.renewal_renewal_fields_gets_reminders_with_nobody_named()}
	placeholder={m.renewal_renewal_fields_placeholder()}
	options={assigneeOptions}
	value={value?.responsibleUserId ?? ''}
/>
<Field
	field={fields.notes}
	type="textarea"
	label={m.renewal_renewal_fields_notes()}
	value={value?.notes ?? ''}
/>
