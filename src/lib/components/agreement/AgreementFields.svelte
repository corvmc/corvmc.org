<script lang="ts">
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import type { createAgreement } from '$lib/remote/agreements.remote';
	import {
		agreementKinds,
		agreementKindLabels,
		agreementStatuses,
		agreementStatusLabels,
		type AgreementKind,
		type AgreementStatus
	} from '$lib/config';

	interface Value {
		kind: AgreementKind;
		counterparty: string;
		title: string;
		status: AgreementStatus;
		amountCents: number | null;
		tier: string | null;
		contactName: string | null;
		contactEmail: string | null;
		applyBy: string | null;
		startsOn: string | null;
		endsOn: string | null;
		reportDueOn: string | null;
		notes: string | null;
	}

	let {
		fields,
		value
	}: {
		fields: (typeof createAgreement)['fields'];
		value?: Value;
	} = $props();

	const kindOptions = agreementKinds.map((k) => ({ value: k, label: agreementKindLabels[k] }));
	const statusOptions = agreementStatuses.map((s) => ({
		value: s,
		label: agreementStatusLabels[s]
	}));
</script>

<Field
	field={fields.kind}
	type="select"
	label="Kind"
	options={kindOptions}
	value={value?.kind ?? 'grant'}
/>
<Field
	field={fields.counterparty}
	type="text"
	label="With"
	description="The funder or the business."
	value={value?.counterparty ?? ''}
/>
<Field
	field={fields.title}
	type="text"
	label="Title"
	description="“2027 operating support”, “Season sponsor”."
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
	field={fields.amountCents}
	label="Amount"
	description="Asked for until it is awarded, then what was awarded."
	value={value?.amountCents ?? undefined}
/>
<Field field={fields.tier} type="text" label="Tier" value={value?.tier ?? ''} />
<Field field={fields.applyBy} type="date" label="Apply by" value={value?.applyBy ?? ''} />
<Field field={fields.startsOn} type="date" label="Starts" value={value?.startsOn ?? ''} />
<Field field={fields.endsOn} type="date" label="Ends" value={value?.endsOn ?? ''} />
<Field field={fields.reportDueOn} type="date" label="Report due" value={value?.reportDueOn ?? ''} />
<Field field={fields.contactName} type="text" label="Contact" value={value?.contactName ?? ''} />
<Field
	field={fields.contactEmail}
	type="email"
	label="Contact email"
	value={value?.contactEmail ?? ''}
/>
<Field field={fields.notes} type="textarea" label="Notes" value={value?.notes ?? ''} />
