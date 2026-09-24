<script lang="ts">
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
	label="Name"
	description="“General liability insurance”, “OLCC special event license”."
	value={value?.name ?? ''}
/>
<Field
	field={fields.kind}
	type="select"
	label="Kind"
	options={kindOptions}
	value={value?.kind ?? 'permit'}
/>
<Field
	field={fields.issuer}
	type="text"
	label="Issued by"
	description="The city, the OLCC, the insurer."
	value={value?.issuer ?? ''}
/>
<Field
	field={fields.reference}
	type="text"
	label="Reference"
	description="The permit, license or policy number."
	value={value?.reference ?? ''}
/>
<Field field={fields.expiresOn} type="date" label="Expires" value={value?.expiresOn ?? ''} />
<Field
	field={fields.responsibleUserId}
	type="select"
	label="Responsible"
	description="Gets the reminders. With nobody named, everyone who manages renewals does."
	placeholder="Nobody named"
	options={assigneeOptions}
	value={value?.responsibleUserId ?? ''}
/>
<Field field={fields.notes} type="textarea" label="Notes" value={value?.notes ?? ''} />
