<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { deleteClosure } from '#lib/remote/closures.remote.js';

	let {
		closureId,
		variant = 'ghost',
		size = 'sm',
		class: className = 'text-error',
		onsuccess,
		...rest
	}: {
		closureId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const { fields } = deleteClosure;
</script>

<Action
	action={deleteClosure}
	label={m.actions_delete_label()}
	modalTitle={m.actions_confirm_title()}
	successToast={m.actions_delete_closure_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', closureId)} />
		<p class="py-4">{m.actions_delete_closure_delete_closure_text()}</p>
	{/snippet}
</Action>
