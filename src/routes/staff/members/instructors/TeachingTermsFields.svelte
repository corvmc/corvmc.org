<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { Latest } from '#lib/latest.svelte.js';
	import { formatDollars } from '#lib/utils/format.js';
	import { getTeachingTerms, updateTeachingTerms } from '#lib/remote/settings.remote.js';

	// Loads when the modal opens, not with the Teachers view.
	const terms = new Latest(() => getTeachingTerms());
	const fields = updateTeachingTerms.fields;
</script>

{#if terms.current}
	{@const t = terms.current}
	<div class="grid gap-4 sm:grid-cols-2">
		<FormField
			field={fields.teachingRate}
			submitAs="text"
			label={m.staff_members_instructors_teaching_terms_rate_label()}
			type="number"
			value={formatDollars(t.teachingRateCents)}
			min="0"
			step="0.01"
		/>
		<FormField
			field={fields.teachingMinDurationHours}
			submitAs="text"
			label={m.staff_settings_minimum_duration_hours_label()}
			type="number"
			value={String(t.teachingMinDurationHours)}
			min="0.5"
			step="0.5"
		/>
		<FormField
			field={fields.teachingMaxAdvanceDaysOneoff}
			submitAs="text"
			label={m.staff_settings_max_advance_booking_one_off_label()}
			type="number"
			value={String(t.teachingMaxAdvanceDaysOneoff)}
			min="1"
		/>
		<FormField
			field={fields.teachingMaxAdvanceDaysRecurring}
			submitAs="text"
			label={m.staff_settings_max_advance_booking_recurring_days_label()}
			description={m.staff_members_instructors_teaching_terms_recurring_body()}
			type="number"
			value={String(t.teachingMaxAdvanceDaysRecurring)}
			min="1"
		/>
	</div>
{/if}
