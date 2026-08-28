<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createLoan, getAvailableItems } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';

	const { fields } = createLoan;

	let {
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	let userId = $state('');
	let userName = $state('');
</script>

<Action
	action={createLoan}
	label="New Loan"
	modalTitle="Create Loan Request"
	successToast="Loan request created"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<svelte:boundary>
			<div class="space-y-3">
				<MemberPicker field={fields.userId} bind:value={userId} bind:name={userName} />
				<!--
				Awaited here rather than fetched from `/api/equipment` — that route
				does not exist, so the select silently stayed empty and every
				staff-created loan quietly became a free-form request.
			-->
				<Field field={fields.itemId} type="select" label="Equipment">
					<option value="">-- Select equipment --</option>
					{#each await getAvailableItems() as eq (eq.id)}
						<option value={eq.id}>{eq.name}</option>
					{/each}
				</Field>
				<Field field={fields.quantity} type="number" label="Quantity" value={1} />
				<Field field={fields.requestedPickupDate} type="date" label="Requested pickup date" />
				<Field field={fields.estimatedReturnDate} type="date" label="Estimated return date" />
				<Field field={fields.memberNotes} type="textarea" label="Notes (optional)" />
			</div>

			{#snippet pending()}
				<div class="flex items-center justify-center p-8">
					<span class="loading loading-md loading-spinner"></span>
				</div>
			{/snippet}
		</svelte:boundary>
	{/snippet}
</Action>
