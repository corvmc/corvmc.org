<script lang="ts">
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import type { createGrant } from '$lib/remote/grants.remote';
	import { grantStatuses, grantStatusLabels, type GrantStatus } from '$lib/config';

	interface Value {
		funderId: string;
		title: string;
		status: GrantStatus;
		amountRequestedCents: number | null;
		amountAwardedCents: number | null;
		applyBy: string | null;
		startsOn: string | null;
		endsOn: string | null;
		notes: string | null;
	}

	let {
		fields,
		funders,
		value
	}: {
		fields: (typeof createGrant)['fields'];
		funders: { id: string; name: string }[];
		value?: Value;
	} = $props();

	const funderOptions = $derived(funders.map((f) => ({ value: f.id, label: f.name })));
	const statusOptions = grantStatuses.map((s) => ({ value: s, label: grantStatusLabels[s] }));
</script>

<Field
	field={fields.funderId}
	type="select"
	label="Funder"
	options={funderOptions}
	value={value?.funderId ?? funders[0]?.id ?? ''}
/>
<Field
	field={fields.title}
	type="text"
	label="Title"
	description="“2027 operating support”, “Youth workshops”."
	value={value?.title ?? ''}
/>
<Field
	field={fields.status}
	type="select"
	label="Status"
	options={statusOptions}
	value={value?.status ?? 'prospect'}
/>
<MoneyField
	field={fields.amountRequestedCents}
	label="Requested"
	value={value?.amountRequestedCents ?? undefined}
/>
<MoneyField
	field={fields.amountAwardedCents}
	label="Awarded"
	description="Blank until the funder decides."
	value={value?.amountAwardedCents ?? undefined}
/>
<Field field={fields.applyBy} type="date" label="Apply by" value={value?.applyBy ?? ''} />
<Field field={fields.startsOn} type="date" label="Award starts" value={value?.startsOn ?? ''} />
<Field field={fields.endsOn} type="date" label="Award ends" value={value?.endsOn ?? ''} />
<Field field={fields.notes} type="textarea" label="Notes" value={value?.notes ?? ''} />
