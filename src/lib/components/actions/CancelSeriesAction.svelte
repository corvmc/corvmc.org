<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
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
	label={m.actions_cancel()}
	modalTitle={m.actions_confirm()}
	successToast={m.actions_cancel_series_success_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', seriesId)} />
		<p class="py-4">
			{m.actions_cancel_series_cancel_recurring_series_next_session()}
		</p>
	{/snippet}
</Action>
