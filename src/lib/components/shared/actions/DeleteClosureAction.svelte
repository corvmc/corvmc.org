<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { deleteClosure } from '$lib/remote/closures.remote';

	let {
		closureId,
		variant = 'ghost',
		size = 'sm',
		class: className = 'text-error',
		onsuccess,
		...rest
	}: {
		closureId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const { fields } = deleteClosure;
</script>

<Action
	action={deleteClosure}
	label="Delete"
	modalTitle="Confirm"
	successToast="Closure deleted"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', closureId)} />
		<p class="py-4">Delete this closure?</p>
	{/snippet}
</Action>
