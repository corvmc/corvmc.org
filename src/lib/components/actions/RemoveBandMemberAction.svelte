<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { removeBandMember } from '#lib/remote/bands.remote.js';

	const { fields } = removeBandMember;

	let {
		memberId,
		name,
		variant = 'ghost',
		size = 'xs',
		class: className = 'text-error',
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
	action={removeBandMember}
	label={m.actions_remove_label()}
	modalTitle={m.actions_confirm_title()}
	successToast={m.actions_remove_band_member_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.memberId.as('hidden', memberId)} />
		<p class="py-4">{m.actions_remove_band_member_remove_from_band_text({ name })}</p>
	{/snippet}
</Action>
