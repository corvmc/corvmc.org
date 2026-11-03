<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { revokeStaffEmailInvite } from '$lib/remote/bands.remote';

	const { fields } = revokeStaffEmailInvite;

	let {
		inviteId,
		email,
		variant = 'ghost',
		size = 'xs',
		class: className = 'text-warning',
		onsuccess,
		...rest
	}: {
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
	action={revokeStaffEmailInvite}
	label={m.actions_revoke()}
	modalTitle={m.actions_confirm()}
	successToast={m.actions_revoke_email_invite_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.inviteId.as('hidden', inviteId)} />
		<p class="py-4">{m.actions_revoke_email_invite_revoke_invite({ email })}</p>
	{/snippet}
</Action>
