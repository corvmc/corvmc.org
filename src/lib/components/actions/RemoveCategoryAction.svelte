<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { removeCategory } from '$lib/remote/inventory.remote';

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
	label="Delete"
	modalTitle="Confirm"
	successToast="Category deleted"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', categoryId)} />
		<p class="py-4">Delete "{name}"? Category must have no equipment.</p>
	{/snippet}
</Action>
