<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The member's own hour log, in its three variants.
	 *
	 * They are one form with three different amounts already known, and writing
	 * them as three components would be three places for the validation copy to
	 * drift:
	 *
	 * - **free** — started from nowhere, so it asks which role first.
	 * - **shift** — started from a worked shift that owes hours, so the role,
	 *   date and duration are already known and the picker would be asking a
	 *   question the button already answered.
	 * - **fix** — a log the member is correcting. Same fields, filled in; the
	 *   service classifies it again, as if it were new.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { clubToday, VOLUNTEER_HOUR_STEP, VOLUNTEER_DESCRIPTION_MAX } from '#lib/config.js';
	import { submitVolunteerHours, editVolunteerHours } from '#lib/remote/volunteer.remote.js';

	type Role = { id: string; name: string };
	type Program = { id: string; name: string };

	let {
		mode = 'free',
		roles = [],
		programs = [],
		label,
		variant = 'ghost',
		size = 'sm',
		shift,
		log
	}: {
		mode?: 'free' | 'shift' | 'fix';
		roles?: Role[];
		/** Committees and clubs the member belongs to. Empty hides the picker. */
		programs?: Program[];
		label?: string;
		variant?: 'primary' | 'ghost';
		size?: 'xs' | 'sm' | 'md';
		/** `shift` mode: the worked shift the hours are owed for. */
		shift?: {
			signupId: string;
			shiftId: string;
			volunteerRoleId: string;
			roleName: string;
			/** Null for an unscheduled work order. */
			startsAt: Date | null;
			hours: string;
			workedOn: string;
		};
		/** `fix` mode: the returned log being corrected. */
		log?: {
			id: string;
			volunteerRoleId: string;
			workedOn: string;
			hours: string;
			description: string;
		};
	} = $props();

	// `.for()` keys the form instance. A free entry has nothing to key on, so it
	// uses the bare form — two of those on one page would share state, which is
	// why the dashboard renders exactly one.
	const submitForm = $derived(
		shift ? submitVolunteerHours.for(shift.signupId) : submitVolunteerHours
	);
	const editForm = $derived(log ? editVolunteerHours.for(log.id) : undefined);
	const action = $derived(mode === 'fix' ? editForm! : submitForm);

	const title = $derived(
		mode === 'fix'
			? m.volunteer_log_hours_fix_these_hours()
			: mode === 'shift'
				? m.volunteer_log_hours_log_these_hours()
				: m.volunteer_log_hours_log_hours()
	);
</script>

<Action
	{action}
	label={label ?? title}
	data-testid="log-hours-{mode}"
	{variant}
	{size}
	modalTitle={title}
	submitLabel={mode === 'fix' ? m.volunteer_save() : m.volunteer_log_hours_file()}
	successToast={mode === 'fix' ? m.volunteer_log_hours_saved() : m.volunteer_hours_logged()}
>
	{#snippet form()}
		{#if mode === 'fix'}
			<input {...editForm!.fields.id.as('hidden', log!.id)} />
			<input {...editForm!.fields.volunteerRoleId.as('hidden', log!.volunteerRoleId)} />
		{:else if mode === 'shift'}
			<input {...submitForm.fields.volunteerRoleId.as('hidden', shift!.volunteerRoleId)} />
			<input {...submitForm.fields.shiftId.as('hidden', shift!.shiftId)} />
			<p class="text-sm">{m.volunteer_log_hours_pre_filled_from_shift_adjust()}</p>
		{:else}
			<label class="fieldset w-full">
				<span class="fieldset-legend">{m.volunteer_log_hours_what_did_help_with()}</span>
				<Select {...submitForm.fields.volunteerRoleId.as('select')}>
					{#each roles as role (role.id)}
						<option value={role.id}>{role.name}</option>
					{/each}
				</Select>
			</label>
		{/if}

		{#if mode !== 'fix' && programs.length > 0}
			<!-- Only for somebody who is on one. Most volunteering is for CMC at
			     large, so this stays optional and blank by default. -->
			<label class="fieldset w-full">
				<span class="fieldset-legend">{m.volunteer_log_hours_was_committee_club()}</span>
				<Select {...submitForm.fields.groupId.as('select')}>
					<option value="">{m.volunteer_log_hours_cmc_generally()}</option>
					{#each programs as program (program.id)}
						<option value={program.id}>{program.name}</option>
					{/each}
				</Select>
			</label>
		{/if}

		<FormField
			field={action.fields.workedOn}
			label={m.volunteer_date()}
			type="date"
			max={clubToday()}
			value={mode === 'fix' ? log!.workedOn : mode === 'shift' ? shift!.workedOn : clubToday()}
		/>
		<FormField
			field={action.fields.hours}
			submitAs="text"
			label={m.volunteer_hours()}
			type="number"
			step={VOLUNTEER_HOUR_STEP}
			min="0.25"
			max="12"
			value={mode === 'fix' ? log!.hours : mode === 'shift' ? shift!.hours : ''}
			description={m.volunteer_log_hours_nearest_quarter_hour_twelve_most()}
		/>
		<FormField
			field={action.fields.description}
			label={m.volunteer_log_hours_what_did()}
			type="textarea"
			maxlength={VOLUNTEER_DESCRIPTION_MAX}
			value={mode === 'fix' ? log!.description : ''}
			description={m.volunteer_log_hours_one_sentence()}
		/>
	{/snippet}
</Action>
