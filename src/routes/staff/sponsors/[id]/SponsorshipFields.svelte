<script lang="ts">
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import type { createSponsorship } from '$lib/remote/sponsors.remote';
	import {
		sponsorshipStatuses,
		sponsorshipStatusLabels,
		type SponsorshipStatus
	} from '$lib/config';

	interface Value {
		title: string;
		status: SponsorshipStatus;
		tier: string | null;
		amountCents: number | null;
		startsOn: string | null;
		endsOn: string | null;
		notes: string | null;
	}

	let {
		fields,
		value
	}: {
		fields: (typeof createSponsorship)['fields'];
		value?: Value;
	} = $props();

	const statusOptions = sponsorshipStatuses.map((s) => ({
		value: s,
		label: sponsorshipStatusLabels[s]
	}));
</script>

<Field
	field={fields.title}
	type="text"
	label="Title"
	description="“2027 season”, “Summer concert series”."
	value={value?.title ?? ''}
/>
<Field
	field={fields.status}
	type="select"
	label="Status"
	options={statusOptions}
	value={value?.status ?? 'prospect'}
/>
<Field
	field={fields.tier}
	type="text"
	label="Tier"
	description="Free text: “Gold”, “In kind”."
	value={value?.tier ?? ''}
/>
<MoneyField field={fields.amountCents} label="Amount" value={value?.amountCents ?? undefined} />
<Field field={fields.startsOn} type="date" label="Starts" value={value?.startsOn ?? ''} />
<Field field={fields.endsOn} type="date" label="Ends" value={value?.endsOn ?? ''} />
<Field field={fields.notes} type="textarea" label="Notes" value={value?.notes ?? ''} />
