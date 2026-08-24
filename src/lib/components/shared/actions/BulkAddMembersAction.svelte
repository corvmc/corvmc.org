<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { bulkAddMembers } from '$lib/remote/marketing.remote';

	const { fields } = bulkAddMembers;

	let {
		audienceId,
		variant = 'default',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		...rest
	}: {
		audienceId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: (result: unknown) => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={bulkAddMembers}
	label="Add all active members"
	modalTitle="Confirm"
	successToast="Members added"
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.audienceId.as('hidden', audienceId)} />
		<p class="py-4">Add all active members to this audience?</p>
	{/snippet}
</Action>
