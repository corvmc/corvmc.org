<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
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
	label="Delete"
	modalTitle="Confirm"
	successToast="Audience deleted"
	{variant}
	{size}
	class={className}
	{onsuccess}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', audienceId)} />
		<p class="py-4">Delete this audience? All subscribers will be removed.</p>
	{/snippet}
</Action>
