<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { cancelRecurringSeries } from '$lib/remote/recurring.remote';

	let {
		seriesId,
		variant = 'error',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		...rest
	}: {
		seriesId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const { fields } = cancelRecurringSeries;
</script>

<Action
	action={cancelRecurringSeries}
	label="Cancel"
	modalTitle="Confirm"
	successToast="Series cancelled"
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', seriesId)} />
		<p class="py-4">Cancel this recurring series? Future reservations will not be created.</p>
	{/snippet}
</Action>
