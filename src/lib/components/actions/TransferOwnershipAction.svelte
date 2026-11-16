<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { transferOwnership } from '#lib/remote/bands.remote.js';

	const { fields } = transferOwnership;

	let {
		bandId,
		newOwnerId,
		name,
		variant = 'ghost',
		size = 'xs',
		class: className = '',
		onsuccess,
		...rest
	}: {
		bandId: string;
		newOwnerId: string;
		name: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={transferOwnership}
	label={m.actions_transfer_ownership_label()}
	modalTitle={m.actions_confirm_title()}
	successToast={m.actions_transfer_ownership_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.bandId.as('hidden', bandId)} />
		<input {...fields.newOwnerId.as('hidden', newOwnerId)} />
		<p class="py-4">
			{m.actions_transfer_ownership_transfer_ownership_current_owner_text({ name })}
		</p>
	{/snippet}
</Action>
