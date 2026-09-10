<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { invalidateAll } from '$app/navigation';
	import { inviteByEmailApi } from '$lib/remote/bands.remote';

	const { fields } = inviteByEmailApi;

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
			<label class="fieldset w-full">
				<span class="fieldset-legend">Email</span>
				<input
					{...fields.email.as('email')}
					class="input w-full"
					placeholder="musician@example.com"
				/>
			</label>
			<label class="fieldset w-full">
				<span class="fieldset-legend">Role</span>
				<Select class="w-full" {...fields.role.as('select')}>
					<option value="member">Member</option>
					<option value="admin">Admin</option>
				</Select>
			</label>
			<label class="fieldset w-full">
				<span class="fieldset-legend">Position (optional)</span>
				<input {...fields.position.as('text')} class="input w-full" placeholder="e.g. Bassist" />
			</label>
		</div>
	{/snippet}
</Action>
