<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { revokeBandInvite } from '$lib/remote/bands.remote';

	const { fields } = revokeBandInvite;

	let {
		memberId,
		name,
		variant = 'ghost',
		size = 'xs',
		class: className = 'text-warning',
		onsuccess,
		...rest
	}: {
		bandId: string;
		memberId: string;
		name: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={revokeBandInvite}
	label="Revoke"
	modalTitle="Confirm"
	successToast="Invitation revoked"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.memberId.as('hidden', memberId)} />
		<p class="py-4">Revoke invitation for {name}?</p>
	{/snippet}
</Action>
