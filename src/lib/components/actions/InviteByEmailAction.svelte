<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { inviteByEmailApi } from '$lib/remote/bands.remote';

	const { fields } = inviteByEmailApi;

	const ROLE_OPTIONS = [
		{ value: 'member', label: m.actions_member() },
		{ value: 'admin', label: m.actions_admin() }
	];

	let {
		bandId,
		variant = 'primary',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		...rest
	}: {
		bandId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={inviteByEmailApi}
	label={m.actions_invite_by_email_invite_by_email()}
	modalTitle={m.actions_invite_by_email_invite_by_email()}
	successToast={m.actions_invite_by_email_success_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.bandId.as('hidden', bandId)} />
		<div class="space-y-3">
			<p class="text-muted">
				{m.actions_invite_by_email_invite_someone_who_doesn_t()}
			</p>
			<!-- The handler raises its "already a member" rejection as an issue on
			     `email`, which a bare input renders as `aria-invalid` and nothing else. -->
			<FormField
				field={fields.email}
				type="email"
				label={m.actions_email()}
				placeholder={m.actions_invite_by_email_musician_example_com()}
			/>
			<FormField
				field={fields.role}
				type="select"
				label={m.actions_role()}
				options={ROLE_OPTIONS}
			/>
			<FormField
				field={fields.position}
				label={m.actions_position_optional()}
				placeholder={m.actions_invite_by_email_e_g_bassist()}
			/>
		</div>
	{/snippet}
</Action>
