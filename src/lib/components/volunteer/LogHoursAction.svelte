<script lang="ts">
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
	 * - **fix** — a returned log being corrected. Same fields, filled in, and it
	 *   resubmits as pending rather than editing an approved record.
	 */
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { clubToday, VOLUNTEER_HOUR_STEP, VOLUNTEER_DESCRIPTION_MAX } from '$lib/config';
	import { submitVolunteerHours, editVolunteerHours } from '$lib/remote/volunteer.remote';

	type Role = { id: string; name: string };

	let {
		mode = 'free',
		roles = [],
		label,
		variant = 'ghost',
		size = 'sm',
		shift,
		log
	}: {
		mode?: 'free' | 'shift' | 'fix';
		roles?: Role[];
		label?: string;
		variant?: 'primary' | 'ghost';
		size?: 'xs' | 'sm' | 'md';
		/** `shift` mode: the worked shift the hours are owed for. */
		shift?: {
			signupId: string;
			shiftId: string;
			volunteerRoleId: string;
			roleName: string;
			startsAt: Date;
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
	const action = $derived(
		mode === 'fix'
			? editVolunteerHours.for(log!.id)
			: shift
				? submitVolunteerHours.for(shift.signupId)
				: submitVolunteerHours
	);

	const title = $derived(
		mode === 'fix' ? 'Fix these hours' : mode === 'shift' ? 'Log these hours' : 'Log hours'
	);
</script>

<Action
	{action}
	label={label ?? title}
	{variant}
	{size}
	modalTitle={title}
	submitLabel={mode === 'fix' ? 'Resubmit' : 'File it'}
	successToast={mode === 'fix'
		? 'Resubmitted. Staff will look again.'
		: 'Filed. Staff review next.'}
>
	{#snippet form()}
		{#if mode === 'fix'}
			<input type="hidden" name="id" value={log!.id} />
			<input type="hidden" name="volunteerRoleId" value={log!.volunteerRoleId} />
		{:else if mode === 'shift'}
			<input type="hidden" name="volunteerRoleId" value={shift!.volunteerRoleId} />
			<input type="hidden" name="shiftId" value={shift!.shiftId} />
			<p class="text-sm">Pre-filled from the shift. Adjust if it differs.</p>
		{:else}
			<label class="form-control w-full">
				<div class="label"><span class="label-text">What did you help with?</span></div>
				<Select name="volunteerRoleId">
					{#each roles as role (role.id)}
						<option value={role.id}>{role.name}</option>
					{/each}
				</Select>
			</label>
		{/if}

		<FormField
			name="workedOn"
			label="Date"
			type="date"
			max={clubToday()}
			value={mode === 'fix' ? log!.workedOn : mode === 'shift' ? shift!.workedOn : clubToday()}
		/>
		<FormField
			name="hours"
			label="Hours"
			type="number"
			step={VOLUNTEER_HOUR_STEP}
			min="0.25"
			max="12"
			value={mode === 'fix' ? log!.hours : mode === 'shift' ? shift!.hours : ''}
			description="To the nearest quarter hour. Twelve is the most one log can carry."
		/>
		<FormField
			name="description"
			label="What you did"
			type="textarea"
			maxlength={VOLUNTEER_DESCRIPTION_MAX}
			value={mode === 'fix' ? log!.description : ''}
			description="One sentence. Staff read this when reviewing."
		/>
	{/snippet}
</Action>
