<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
	data-testid="use-stock"
	label={m.actions_use_stock_use()}
	modalTitle={m.actions_use_stock_modal_title()}
	successToast={m.actions_recorded()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.itemId.as('hidden', itemId)} />
		<Field field={fields.quantity} type="number" label={m.actions_use_stock_how_many()} value={1} />
		<Field field={fields.notes} type="textarea" label={m.actions_use_stock_what()} />
	{/snippet}
</Action>
