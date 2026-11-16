<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { inviteFriendForm } from '#lib/remote/users.remote.js';
	import { Field } from '../ui/Form';
	import { toast } from 'svelte-sonner';

	/** Any member inviting somebody to CMC; the remote caps how many a day. */
	const { fields } = inviteFriendForm;

	let {
		variant = 'ghost',
		size = 'sm'
	}: {
		variant?: ButtonVariant;
		size?: ButtonSize;
	} = $props();

	function onsuccess(result?: unknown) {
		const r = result as { email: string } | undefined;
		if (r) toast.success(m.actions_invite_friend_toast({ email: r.email }));
	}
</script>

<Action
	action={inviteFriendForm}
	label={m.actions_invite_friend_invite_friend_label()}
	modalTitle={m.actions_invite_friend_invite_friend_title()}
	submitLabel={m.actions_invite_friend_submit_label()}
	{variant}
	{size}
	{onsuccess}
>
	{#snippet form()}
		<Field field={fields.email} type="email" label={m.actions_email_label()} required />
		<Field field={fields.name} type="text" label={m.actions_name_optional_label()} />
	{/snippet}
</Action>
