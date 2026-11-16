<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import {
		getVolunteeringSettingsPage,
		updateOrientationSettings,
		updateVolunteerValueSettings
	} from '#lib/remote/settings.remote.js';
	import { hourValueState, switchState } from '../../section-state';

	// Volunteering's own settings, moved out of global Settings and the Practice
	// space settings (#2763). One query.
	const settings = $derived(await getVolunteeringSettingsPage());
	const volunteerValue = $derived(settings.volunteerValue);
	const orientation = $derived(settings.orientation);
</script>

<PageHeader width="2xl" title={m.staff_volunteering_settings_title()} />

<PageContent width="2xl">
	<div class="space-y-4">
		<Form
			remote={updateVolunteerValueSettings}
			guard
			successToast={m.staff_settings_volunteer_hour_value_updated_toast()}
		>
			<InfoCard
				title={m.staff_settings_volunteer_hour_value_title()}
				state={hourValueState(volunteerValue.hourValueCents)}
			>
				{#snippet action()}
					<SubmitButton
						label={m.staff_settings_save_label()}
						successLabel={m.staff_settings_saved_label()}
						errorLabel={m.staff_settings_error_label()}
						variant="primary"
						size="sm"
					/>
				{/snippet}
				<p class="text-subtle">
					{m.staff_settings_what_hour_donated_time_worth_text()}
				</p>

				<div class="mt-2 grid gap-4 sm:grid-cols-2">
					<FormField
						field={updateVolunteerValueSettings.fields.hourValueCents}
						submitAs="text"
						label={m.staff_settings_hourly_value_cents_label()}
						type="number"
						value={String(volunteerValue.hourValueCents)}
						placeholder="3766"
					/>
					<FormField
						field={updateVolunteerValueSettings.fields.hourValueSource}
						label={m.staff_settings_source_label()}
						type="text"
						value={volunteerValue.hourValueSource}
						placeholder={m.staff_settings_independent_sector_oregon_2025_placeholder()}
					/>
				</div>
			</InfoCard>
		</Form>

		<Form
			remote={updateOrientationSettings}
			guard
			successToast={m.staff_settings_orientation_updated_toast()}
		>
			<InfoCard
				title={m.staff_settings_orientation_title()}
				state={switchState(orientation.roleId !== '')}
			>
				{#snippet action()}
					<SubmitButton
						label={m.staff_settings_save_label()}
						successLabel={m.staff_settings_saved_label()}
						errorLabel={m.staff_settings_error_label()}
						variant="primary"
						size="sm"
					/>
				{/snippet}
				<p class="text-subtle">
					{m.staff_settings_member_s_first_rehearsal_booking_text()}
				</p>

				<div class="mt-2 grid gap-4 sm:grid-cols-2">
					<FormField
						field={updateOrientationSettings.fields.roleId}
						label={m.staff_settings_role_label()}
						type="select"
						value={orientation.roleId}
						options={[
							{ value: '', label: m.staff_settings_none_label() },
							...orientation.roles.map((r) => ({ value: r.id, label: r.name }))
						]}
					/>
					<FormField
						field={updateOrientationSettings.fields.minutes}
						submitAs="text"
						label={m.staff_settings_length_minutes_label()}
						type="number"
						value={String(orientation.minutes)}
					/>
					<FormField
						field={updateOrientationSettings.fields.leadMinutes}
						submitAs="text"
						label={m.staff_settings_starts_before_booking_minutes_label()}
						type="number"
						value={String(orientation.leadMinutes)}
					/>
				</div>
				<FormField
					field={updateOrientationSettings.fields.tasks}
					label={m.staff_settings_checklist_label()}
					type="textarea"
					description={m.staff_settings_one_task_per_line_body()}
					value={orientation.tasks.join('\n')}
				/>
				<FormField
					field={updateOrientationSettings.fields.firstVisitNotes}
					label={m.staff_settings_first_visit_notes_label()}
					type="textarea"
					description={m.staff_settings_first_visit_notes_body()}
					value={orientation.firstVisitNotes}
				/>
			</InfoCard>
		</Form>
	</div>
</PageContent>
