<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
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
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Email</span></div>
				<input
					{...fields.email.as('email')}
					class="input w-full"
					placeholder="musician@example.com"
				/>
			</label>
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Role</span></div>
				<Select class="w-full" {...fields.role.as('select')}>
					<option value="member">Member</option>
					<option value="admin">Admin</option>
				</Select>
			</label>
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Position (optional)</span></div>
				<input {...fields.position.as('text')} class="input w-full" placeholder="e.g. Bassist" />
			</label>
		</div>
	{/snippet}
</Action>
