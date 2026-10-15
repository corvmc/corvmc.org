<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonShape, ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { updateClosure } from '$lib/remote/closures.remote';
	import { Field } from '../ui/Form';
	import { toLocalDateTime } from '$lib/utils/format';

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
	label="Edit closure"
	modalTitle="Edit Closure"
	submitLabel="Save"
	successToast="Closure updated"
	{variant}
	{size}
	{shape}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', closure.id)} />
		<Field field={fields.reason} type="text" label="Reason" value={closure.reason} />
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.startsAt}
				type="datetime-local"
				label="Start"
				value={toLocalDateTime(closure.startsAt)}
			/>
			<Field
				field={fields.endsAt}
				type="datetime-local"
				label="End"
				value={toLocalDateTime(closure.endsAt)}
			/>
		</div>
	{/snippet}
</Action>
