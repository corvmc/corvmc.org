<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { reportBuildingProblemForm } from '$lib/remote/work-requests.remote';
	import { Field } from '../ui/Form';

	/**
	 * A member reporting something wrong with the building — not a piece of gear,
	 * which is reported from its own page and can be taken out of service.
	 */
	const { fields } = reportBuildingProblemForm;

	let {
		variant = 'ghost',
		size = 'sm'
	}: {
		variant?: ButtonVariant;
		size?: ButtonSize;
	} = $props();
</script>

<Action
	action={reportBuildingProblemForm}
	label={m.actions_report_building_problem_report_building_problem()}
	modalTitle={m.actions_report_building_problem_report_building_problem()}
	submitLabel={m.actions_report_building_problem_submit_label()}
	successToast={m.actions_thanks_staff_have_been_told()}
	{variant}
	{size}
>
	{#snippet form()}
		<Field
			field={fields.location}
			type="text"
			label={m.actions_report_building_problem_where()}
			description={m.actions_report_building_problem_which_room_area_downstairs_b()}
		/>
		<Field
			field={fields.note}
			type="textarea"
			label={m.actions_what_s_wrong()}
			description={m.actions_report_building_problem_whatever_noticed_enough_brok()}
		/>
	{/snippet}
</Action>
