<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { setTaskPosition } from '#lib/remote/volunteer.remote.js';

	/** Tags a task for one of its committee's positions, or for the whole committee (#2990). */
	let {
		workOrderId,
		positionId,
		positions
	}: {
		workOrderId: string;
		positionId: string | null;
		positions: { id: string; name: string }[];
	} = $props();

	const set = $derived(setTaskPosition.for(workOrderId));
	const options = $derived(positions.map((p) => ({ value: p.id, label: p.name })));
</script>

<Action
	action={set}
	label={m.staff_tasks_change_position_label()}
	variant="ghost"
	size="sm"
	modalTitle={m.staff_tasks_change_position_title()}
	successToast={m.staff_tasks_position_changed_toast()}
	data-testid="set-position"
>
	{#snippet form()}
		<input {...set.fields.id.as('hidden', workOrderId)} />
		<Field
			field={set.fields.positionId}
			type="select"
			label={m.staff_tasks_position_label()}
			placeholder={m.staff_tasks_no_position_placeholder()}
			description={m.staff_tasks_position_description_body()}
			{options}
			value={positionId ?? ''}
		/>
	{/snippet}
</Action>
