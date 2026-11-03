<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { removeCategory } from '#lib/remote/inventory.remote.js';

	const { fields } = removeCategory;

	let {
		categoryId,
		name,
		variant = 'ghost',
		size = 'xs',
		class: className = 'text-error',
		onsuccess,
		...rest
	}: {
		categoryId: string;
		name: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={removeCategory}
	label={m.actions_delete()}
	modalTitle={m.actions_confirm()}
	successToast={m.actions_remove_category_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', categoryId)} />
		<p class="py-4">{m.actions_remove_category_delete_category_must_have_no({ name })}</p>
	{/snippet}
</Action>
