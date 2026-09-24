<script lang="ts">
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
	label="Report a building problem"
	modalTitle="Report a building problem"
	submitLabel="Send report"
	successToast="Thanks — staff have been told"
	{variant}
	{size}
>
	{#snippet form()}
		<Field
			field={fields.location}
			type="text"
			label="Where?"
			description="Which room or area — “downstairs bathroom”, “Room B”, “the back door”."
		/>
		<Field
			field={fields.note}
			type="textarea"
			label="What's wrong?"
			description="Whatever you noticed is enough. For a broken amp or mic, report it from the equipment's own page instead."
		/>
	{/snippet}
</Action>
