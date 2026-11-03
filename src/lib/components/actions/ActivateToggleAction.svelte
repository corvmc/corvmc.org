<script lang="ts" generics="TOffOut, TOnOut">
	import { m } from '#lib/paraglide/messages.js';
	import type { RemoteForm } from '@sveltejs/kit';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';

	let {
		entityId,
		isDeactivated,
		deactivateAction,
		reactivateAction,
		entityLabel = m.actions_activate_toggle_entity_default(),
		deactivateWarning,
		variant,
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		entityId: string;
		isDeactivated: boolean;
		deactivateAction: RemoteForm<{ id: string }, TOffOut>;
		reactivateAction: RemoteForm<{ id: string }, TOnOut>;
		entityLabel?: string;
		deactivateWarning?: string;
		/** Defaults to the direction of travel: green to reactivate, red to deactivate. */
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const action = $derived(isDeactivated ? reactivateAction : deactivateAction);
	const fields = $derived(action.fields);
	const label = $derived(
		isDeactivated
			? m.actions_activate_toggle_reactivate_label()
			: m.actions_activate_toggle_deactivate_label()
	);
	const resolvedVariant = $derived(variant ?? (isDeactivated ? 'success' : 'error'));
	const confirmText = $derived(
		isDeactivated
			? undefined
			: (deactivateWarning ?? m.actions_activate_toggle_deactivate_confirm({ entityLabel }))
	);
	const toast = $derived(
		isDeactivated
			? m.actions_activate_toggle_reactivated({ entityLabel })
			: m.actions_activate_toggle_deactivated({ entityLabel })
	);
</script>

<Action
	{action}
	{label}
	modalTitle={m.actions_confirm()}
	successToast={toast}
	variant={resolvedVariant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', entityId)} />
		{#if confirmText}
			<p class="py-4">{confirmText}</p>
		{:else}
			<p class="py-4">{m.actions_activate_toggle_reactivate({ entityLabel })}</p>
		{/if}
	{/snippet}
</Action>
