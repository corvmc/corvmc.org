<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { createClosure } from '#lib/remote/closures.remote.js';
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
	label={m.actions_create_closure_new_closure()}
	modalTitle={m.actions_create_closure_new_closure()}
	submitLabel={m.actions_create_closure_submit_label()}
	successToast={m.actions_create_closure_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<Field field={fields.reason} type="text" label={m.actions_reason()} />
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.startsAt} type="datetime-local" label={m.actions_start()} />
			<Field field={fields.endsAt} type="datetime-local" label={m.actions_end()} />
		</div>
	{/snippet}
</Action>
