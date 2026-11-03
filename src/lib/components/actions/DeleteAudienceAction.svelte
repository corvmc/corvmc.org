<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { deleteAudience } from '$lib/remote/marketing.remote';

	const { fields } = deleteAudience;

	let {
		audienceId,
		variant = 'error',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		audienceId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={deleteAudience}
	label={m.actions_delete()}
	modalTitle={m.actions_confirm()}
	successToast={m.actions_delete_audience_success_toast()}
	{variant}
	{size}
	class={className}
	{onsuccess}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', audienceId)} />
		<p class="py-4">{m.actions_delete_audience_delete_audience_all_subscribers_will()}</p>
	{/snippet}
</Action>
