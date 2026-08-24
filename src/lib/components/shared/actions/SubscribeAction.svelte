<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { subscribe } from '$lib/remote/account.remote';

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
	label="Subscribe"
	modalTitle="Subscribe"
	successToast={`Subscribed to ${name}`}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.audienceId.as('hidden', audienceId)} />
		<p class="py-4">Subscribe to {name}?</p>
	{/snippet}
</Action>
