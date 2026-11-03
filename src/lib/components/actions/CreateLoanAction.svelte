<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createLoan, getAvailableItems } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { errorMessage } from '$lib/error-message';
	import { retryQuery } from '$lib/utils/retry-query';

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
	label={m.actions_create_loan_new_loan()}
	modalTitle={m.actions_create_loan_modal_title()}
	successToast={m.actions_create_loan_success_toast()}
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

				That fix was only half of it: these `<option>`s are children, and
				`FormField` used to render children *instead of* the select, so they
				came out as bare text with no control around them and the field
				submitted nothing at all. The branch order is fixed; the placeholder
				moves to the prop that owns it, and `value=""` selects it, so the
				closed select reads as a prompt rather than a blank box.
			-->
				<Field
					field={fields.itemId}
					type="select"
					label={m.actions_create_loan_equipment()}
					placeholder={m.actions_create_loan_placeholder()}
					value=""
				>
					{#each await getAvailableItems() as eq (eq.id)}
						<option value={eq.id}>{eq.name}</option>
					{/each}
				</Field>
				<Field field={fields.quantity} type="number" label={m.actions_quantity()} value={1} />
				<Field
					field={fields.requestedPickupDate}
					type="date"
					label={m.actions_create_loan_requested_pickup_date()}
				/>
				<Field
					field={fields.estimatedReturnDate}
					type="date"
					label={m.actions_create_loan_estimated_return_date()}
				/>
				<Field
					field={fields.memberNotes}
					type="textarea"
					label={m.actions_create_loan_notes_optional()}
				/>
			</div>

			{#snippet pending()}
				<div class="flex items-center justify-center p-8">
					<span class="loading loading-md loading-spinner"></span>
				</div>
			{/snippet}

			{#snippet failed(error, reset)}
				<Alert type="warning" reset={() => retryQuery(getAvailableItems(), reset)}>
					{m.actions_create_loan_could_not_load_equipment_list({
						errorMessage: errorMessage(error)
					})}
				</Alert>
			{/snippet}
		</svelte:boundary>
	{/snippet}
</Action>
