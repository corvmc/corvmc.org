<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { transferOwnership } from '$lib/remote/bands.remote';

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
	label="Make owner"
	modalTitle="Confirm"
	successToast="Ownership transferred"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.bandId.as('hidden', bandId)} />
		<input {...fields.newOwnerId.as('hidden', newOwnerId)} />
		<p class="py-4">Transfer ownership to {name}? The current owner will be demoted to admin.</p>
	{/snippet}
</Action>
