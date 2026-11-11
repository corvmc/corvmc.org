<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonShape, ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { updateClosure } from '#lib/remote/closures.remote.js';
	import { Field } from '../ui/Form';
	import { toLocalDateTime } from '#lib/utils/format.js';

	/** Edits a closure in a modal, prefilled. The list row is all it needs. */
	let {
		closure,
		variant = 'ghost',
		size = 'sm',
		shape,
		class: className = '',
		onsuccess,
		...rest
	}: {
		closure: { id: string; reason: string; startsAt: Date; endsAt: Date };
		variant?: ButtonVariant;
		size?: ButtonSize;
		shape?: ButtonShape;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const edit = $derived(updateClosure.for(closure.id));
	const fields = $derived(edit.fields);
</script>

<Action
	action={edit}
	label={m.actions_update_closure_edit_closure_label()}
	modalTitle={m.actions_update_closure_modal_title()}
	submitLabel={m.actions_update_closure_submit_label()}
	successToast={m.actions_update_closure_success_toast()}
	{variant}
	{size}
	{shape}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', closure.id)} />
		<Field
			field={fields.reason}
			type="text"
			label={m.actions_reason_label()}
			value={closure.reason}
		/>
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.startsAt}
				type="datetime-local"
				label={m.actions_start_label()}
				value={toLocalDateTime(closure.startsAt)}
			/>
			<Field
				field={fields.endsAt}
				type="datetime-local"
				label={m.actions_end_label()}
				value={toLocalDateTime(closure.endsAt)}
			/>
		</div>
	{/snippet}
</Action>
