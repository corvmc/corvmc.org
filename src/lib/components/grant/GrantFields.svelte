<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import type { createGrant } from '#lib/remote/grants.remote.js';
	import { grantStatuses, grantStatusLabels, type GrantStatus } from '#lib/config.js';

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
	label={m.grant_grant_fields_funder_label()}
	options={funderOptions}
	value={value?.funderId ?? funders[0]?.id ?? ''}
/>
<Field
	field={fields.title}
	type="text"
	label={m.grant_grant_fields_title_label()}
	description={m.grant_grant_fields_2027_operating_support_youth_workshops_body()}
	value={value?.title ?? ''}
/>
<Field
	field={fields.status}
	type="select"
	label={m.grant_grant_fields_status_label()}
	options={statusOptions}
	value={value?.status ?? 'prospect'}
/>
<MoneyField
	field={fields.amountRequestedCents}
	label={m.grant_grant_fields_requested_label()}
	value={value?.amountRequestedCents ?? undefined}
/>
<MoneyField
	field={fields.amountAwardedCents}
	label={m.grant_grant_fields_awarded_label()}
	description={m.grant_grant_fields_blank_until_funder_decides_body()}
	value={value?.amountAwardedCents ?? undefined}
/>
<Field
	field={fields.applyBy}
	type="date"
	label={m.grant_grant_fields_apply_by_label()}
	value={value?.applyBy ?? ''}
/>
<Field
	field={fields.startsOn}
	type="date"
	label={m.grant_grant_fields_award_starts_label()}
	value={value?.startsOn ?? ''}
/>
<Field
	field={fields.endsOn}
	type="date"
	label={m.grant_grant_fields_award_ends_label()}
	value={value?.endsOn ?? ''}
/>
<Field
	field={fields.notes}
	type="textarea"
	label={m.grant_grant_fields_notes_label()}
	value={value?.notes ?? ''}
/>
