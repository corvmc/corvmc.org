<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { revokePlatformInvite } from '$lib/remote/bands.remote';

	const { fields } = revokePlatformInvite;

	let {
		inviteId,
		email,
		variant = 'ghost',
		size = 'xs',
		class: className = 'text-warning',
		onsuccess,
		...rest
	}: {
		bandId: string;
		inviteId: string;
		email: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={revokePlatformInvite}
	label="Revoke"
	modalTitle="Confirm"
	successToast="Invite revoked"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.inviteId.as('hidden', inviteId)} />
		<p class="py-4">Revoke invite for {email}?</p>
	{/snippet}
</Action>
