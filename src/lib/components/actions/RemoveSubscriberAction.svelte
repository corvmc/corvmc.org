<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { removeSubscriber } from '#lib/remote/marketing.remote.js';

	const { fields } = removeSubscriber;

	let {
		audienceId,
		subscriberId,
		email,
		variant = 'ghost',
		size = 'xs',
		class: className = 'text-error',
		onsuccess,
		...rest
	}: {
		audienceId: string;
		subscriberId: string;
		email: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={removeSubscriber}
	label={m.actions_remove()}
	modalTitle={m.actions_confirm()}
	successToast={m.actions_remove_subscriber_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.audienceId.as('hidden', audienceId)} />
		<input {...fields.subscriberId.as('hidden', subscriberId)} />
		<p class="py-4">{m.actions_remove_subscriber_remove_from_audience({ email })}</p>
	{/snippet}
</Action>
