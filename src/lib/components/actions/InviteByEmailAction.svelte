<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { inviteByEmailApi } from '$lib/remote/bands.remote';

	const { fields } = inviteByEmailApi;

	const ROLE_OPTIONS = [
		{ value: 'member', label: 'Member' },
		{ value: 'admin', label: 'Admin' }
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
	label="Invite by Email"
	modalTitle="Invite by Email"
	successToast="Email invitation sent"
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
				Invite someone who doesn't have a CorvMC account. They'll get a signup link and be
				auto-added to this band.
			</p>
			<!-- The handler raises its "already a member" rejection as an issue on
			     `email`, which a bare input renders as `aria-invalid` and nothing else. -->
			<FormField
				field={fields.email}
				type="email"
				label="Email"
				placeholder="musician@example.com"
			/>
			<FormField field={fields.role} type="select" label="Role" options={ROLE_OPTIONS} />
			<FormField field={fields.position} label="Position (optional)" placeholder="e.g. Bassist" />
		</div>
	{/snippet}
</Action>
