<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createClosure } from '$lib/remote/closures.remote';
	import { Field } from '../ui/Form';

	let {
		variant = 'ghost',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const { fields } = createClosure;
</script>

<Action
	action={createClosure}
	label="New Closure"
	modalTitle="New Closure"
	submitLabel="Add Closure"
	successToast="Closure added"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<Field field={fields.reason} type="text" label="Reason" />
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.startsAt} type="datetime-local" label="Start" />
			<Field field={fields.endsAt} type="datetime-local" label="End" />
		</div>
	{/snippet}
</Action>
