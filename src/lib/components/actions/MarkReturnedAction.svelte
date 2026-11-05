<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { returnLoan } from '#lib/remote/inventory.remote.js';
	import { Field } from '../ui/Form';
	import { equipmentConditions } from '#lib/config.js';

	const { fields } = returnLoan;
	const conditionOptions = [
		{ value: '', label: m.actions_mark_returned_not_checked() },
		...equipmentConditions.map((c) => ({ value: c, label: c }))
	];

	let {
		loanId,
		chargeMessage,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		loanId: string;
		chargeMessage?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={returnLoan}
	data-testid="mark-returned"
	label={m.actions_mark_returned_mark_returned()}
	modalTitle={m.actions_mark_returned_modal_title()}
	successToast={m.actions_mark_returned_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', loanId)} />
		{#if chargeMessage}
			<div class="mb-3 rounded bg-base-200 p-3 text-sm">
				<p>{chargeMessage}</p>
			</div>
		{/if}
		<Field
			field={fields.condition}
			type="select"
			label={m.actions_condition()}
			options={conditionOptions}
		/>
		<Field
			field={fields.flagNote}
			type="textarea"
			label={m.actions_mark_returned_something_wrong()}
		/>
		<Field
			field={fields.flagBlocksUse}
			type="checkbox"
			label={m.actions_mark_returned_out_service()}
			value={true}
			checkboxLabel={m.actions_mark_returned_checkbox_label()}
		/>
		<Field
			field={fields.staffNotes}
			type="textarea"
			label={m.actions_mark_returned_staff_notes_optional()}
		/>
	{/snippet}
</Action>
