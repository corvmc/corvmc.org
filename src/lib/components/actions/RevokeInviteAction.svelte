<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
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
	label={m.actions_revoke()}
	modalTitle={m.actions_confirm()}
	successToast={m.actions_revoke_invite_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.memberId.as('hidden', memberId)} />
		<p class="py-4">{m.actions_revoke_invite_revoke_invitation({ name })}</p>
	{/snippet}
</Action>
