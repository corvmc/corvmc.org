<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Record hours for somebody who is not going to log them themselves.
	 *
	 * The other end of a sentence the app has been making for a while and could not keep:
	 * both the help article and the backdate error tell a member to "ask staff to add
	 * anything older", and until now there was nowhere for staff to add anything at all
	 * (docs/reports/volunteer-workflow-findings.md#b1).
	 *
	 * No `max` on the date input, unlike the member form. The whole point of this door is
	 * the log that fell outside the member's 90-day window, and the service still refuses a
	 * date in the future for everybody.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import RoleOptions from '#lib/components/volunteer/RoleOptions.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { IconClockPlus } from '@tabler/icons-svelte';
	import { clubToday, VOLUNTEER_HOUR_STEP } from '#lib/config.js';
	import { logHoursForMember } from '#lib/remote/volunteer.remote.js';

	let {
		/**
		 * Pre-fill for a row that already names somebody — People's per-member
		 * action. The picker is the door for "somebody walked up"; when the row
		 * already knows who, making staff search for the name they just clicked is
		 * a step that exists only because the component was written for the other
		 * case.
		 */
		presetUser = null,
		label = m.volunteer_log_hours_for_member_log_hours(),
		size = 'sm'
	}: {
		presetUser?: { id: string; name: string } | null;
		label?: string;
		size?: 'xs' | 'sm' | 'md';
	} = $props();

	const { fields } = logHoursForMember;

	let userId = $state('');
	let userName = $state('');
</script>

<Action
	action={logHoursForMember}
	{label}
	data-testid="log-hours-for-member"
	icon={clockIcon}
	variant="ghost"
	{size}
	modalTitle={presetUser
		? m.volunteer_log_hours_for_member_log_hours_2({ name: presetUser.name })
		: m.volunteer_log_hours_for_member_log_hours_member()}
	submitLabel={m.volunteer_log_hours_for_member_log_hours()}
	successToast={m.volunteer_hours_logged()}
	onsuccess={() => {
		userId = '';
		userName = '';
	}}
>
	{#snippet form()}
		{#if presetUser}
			<input {...logHoursForMember.fields.userId.as('hidden', presetUser.id)} />
		{:else}
			<MemberPicker field={fields.userId} bind:value={userId} bind:name={userName} />
		{/if}

		<!--
			A plain `<select>` under the shared wrapper rather than FormField's `options`
			prop: RoleOptions owns the role query, and handing it over as options would
			mean this component holding that query open just to pass it down.
		-->
		<label class="fieldset w-full">
			<span class="fieldset-legend"
				>{m.volunteer_log_hours_for_member_what_did_they_help_with()}</span
			>
			<Select {...fields.volunteerRoleId.as('select')}>
				<RoleOptions activeOnly />
			</Select>
		</label>

		<FormField
			field={logHoursForMember.fields.workedOn}
			label={m.volunteer_date()}
			type="date"
			value={clubToday()}
		/>
		<FormField
			field={logHoursForMember.fields.hours}
			submitAs="text"
			label={m.volunteer_hours()}
			type="number"
			step={VOLUNTEER_HOUR_STEP}
			min="0.25"
			description={m.volunteer_log_hours_for_member_nearest_quarter_hour()}
		/>
		<FormField
			field={logHoursForMember.fields.description}
			label={m.volunteer_log_hours_for_member_what_they_did()}
			type="textarea"
			description={m.volunteer_log_hours_for_member_record_s_what_funder_s()}
		/>
		<p class="text-muted">
			{m.volunteer_log_hours_for_member_no_backdate_limit_lands_appro()}
		</p>
	{/snippet}
</Action>

{#snippet clockIcon()}
	<IconClockPlus size={16} />
{/snippet}
