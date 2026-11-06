<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { unsubscribe } from '#lib/remote/account.remote.js';

	const { fields } = unsubscribe;

	let {
		audienceId,
		name,
		variant = 'ghost',
		size = 'xs',
		class: className = '',
		onsuccess,
		...rest
	}: {
		audienceId: string;
		name: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={unsubscribe}
	label={m.actions_unsubscribe_label()}
	modalTitle={m.actions_unsubscribe_label()}
	successToast={m.actions_unsubscribe_success_toast({ name })}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.audienceId.as('hidden', audienceId)} />
		<p class="py-4">{m.actions_unsubscribe_unsubscribe_from({ name })}</p>
	{/snippet}
</Action>
