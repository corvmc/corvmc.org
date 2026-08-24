<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { unsubscribe } from '$lib/remote/account.remote';

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
	label="Unsubscribe"
	modalTitle="Unsubscribe"
	successToast={`Unsubscribed from ${name}`}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.audienceId.as('hidden', audienceId)} />
		<p class="py-4">Unsubscribe from {name}?</p>
	{/snippet}
</Action>
