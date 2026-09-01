<script lang="ts">
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
	import Action from '$lib/components/ui/Action.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { IconClockPlus } from '@tabler/icons-svelte';
	import { clubToday, VOLUNTEER_HOUR_STEP } from '$lib/config';
	import { logHoursForMember } from '$lib/remote/volunteer.remote';

	const { fields } = logHoursForMember;

	let userId = $state('');
	let userName = $state('');
</script>

<Action
	action={logHoursForMember}
	label="Log hours for someone"
	icon={clockIcon}
	variant="ghost"
	size="sm"
	modalTitle="Log hours for a member"
	submitLabel="Record"
	successToast="Hours recorded"
	onsuccess={() => {
		userId = '';
		userName = '';
	}}
>
	{#snippet form()}
		<MemberPicker field={fields.userId} bind:value={userId} bind:name={userName} />

		<!--
			A plain `<select>` under the shared wrapper rather than FormField's `options`
			prop: RoleOptions owns the role query, and handing it over as options would
			mean this component holding that query open just to pass it down.
		-->
		<label class="form-control w-full">
			<div class="label"><span class="label-text">What did they help with?</span></div>
			<Select name="volunteerRoleId">
				<RoleOptions activeOnly />
			</Select>
		</label>

		<FormField name="workedOn" label="Date" type="date" value={clubToday()} />
		<FormField
			name="hours"
			label="Hours"
			type="number"
			step={VOLUNTEER_HOUR_STEP}
			min="0.25"
			description="To the nearest quarter hour."
		/>
		<FormField
			name="description"
			label="What they did"
			type="textarea"
			description="This is the record — it's what a funder's auditor would read."
		/>
		<p class="text-muted">
			Recorded as approved and attributed to you. There is no second review: you typing it in is the
			review.
		</p>
	{/snippet}
</Action>

{#snippet clockIcon()}
	<IconClockPlus size={16} />
{/snippet}
