<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { inviteFriendForm } from '$lib/remote/users.remote';
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
		if (r) toast.success(`Invitation sent to ${r.email}`);
	}
</script>

<Action
	action={inviteFriendForm}
	label="Invite a friend"
	modalTitle="Invite a friend"
	submitLabel="Send invitation"
	{variant}
	{size}
	{onsuccess}
>
	{#snippet form()}
		<Field field={fields.email} type="email" label="Email" required />
		<Field field={fields.name} type="text" label="Name (optional)" />
	{/snippet}
</Action>
