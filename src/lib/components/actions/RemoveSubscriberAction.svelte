<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
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
	label={m.actions_remove_label()}
	modalTitle={m.actions_confirm_title()}
	successToast={m.actions_remove_subscriber_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.audienceId.as('hidden', audienceId)} />
		<input {...fields.subscriberId.as('hidden', subscriberId)} />
		<p class="py-4">{m.actions_remove_subscriber_remove_from_audience_text({ email })}</p>
	{/snippet}
</Action>
