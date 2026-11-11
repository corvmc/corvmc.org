<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** The create and edit forms share every field; `value` pre-fills the edit. */
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import type { createSponsorship } from '#lib/remote/sponsors.remote.js';
	import {
		sponsorshipStatuses,
		sponsorshipStatusLabels,
		type SponsorshipStatus
	} from '#lib/config.js';

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
	label={m.staff_title_label()}
	description={m.staff_sponsors_id_sponsorship_fields_2027_season_summer_conc_body()}
	value={value?.title ?? ''}
/>
<Field
	field={fields.status}
	type="select"
	label={m.staff_status_label()}
	options={statusOptions}
	value={value?.status ?? 'prospect'}
/>
<Field
	field={fields.tier}
	type="text"
	label={m.staff_tier_label()}
	description={m.staff_sponsors_id_sponsorship_fields_free_text_gold_kind_body()}
	value={value?.tier ?? ''}
/>
<MoneyField
	field={fields.amountCents}
	label={m.staff_amount_label()}
	value={value?.amountCents ?? undefined}
/>
<Field
	field={fields.startsOn}
	type="date"
	label={m.staff_starts_label()}
	value={value?.startsOn ?? ''}
/>
<Field field={fields.endsOn} type="date" label={m.staff_ends_label()} value={value?.endsOn ?? ''} />
<Field
	field={fields.notes}
	type="textarea"
	label={m.staff_notes_label()}
	value={value?.notes ?? ''}
/>
