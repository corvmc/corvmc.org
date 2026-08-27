<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { useStock } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';

	const { fields } = useStock;

	let {
		itemId,
		variant = 'ghost',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		itemId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={useStock}
	label="Use"
	modalTitle="Use stock"
	successToast="Recorded"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.itemId.as('hidden', itemId)} />
		<Field field={fields.quantity} type="number" label="How many" value={1} />
		<Field field={fields.notes} type="textarea" label="What for" />
	{/snippet}
</Action>
