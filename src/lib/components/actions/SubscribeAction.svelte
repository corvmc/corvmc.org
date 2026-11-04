<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { subscribe } from '#lib/remote/account.remote.js';

	const { fields } = subscribe;

	let {
		audienceId,
		name,
		variant = 'primary',
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
	action={subscribe}
	label={m.actions_subscribe_label()}
	modalTitle={m.actions_subscribe_label()}
	successToast={m.actions_subscribe_success_toast({ name })}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.audienceId.as('hidden', audienceId)} />
		<p class="py-4">{m.actions_subscribe_subscribe({ name })}</p>
	{/snippet}
</Action>
