<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
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
	label={m.actions_bulk_add_members_label()}
	modalTitle={m.actions_confirm()}
	successToast={m.actions_bulk_add_members_success_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.audienceId.as('hidden', audienceId)} />
		<p class="py-4">{m.actions_bulk_add_members_add_all_active_members_audience()}</p>
	{/snippet}
</Action>
