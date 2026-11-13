<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { checkOutKit } from '#lib/remote/kit-loans.remote.js';
	import { getLocations } from '#lib/remote/inventory.remote.js';
	import { Field } from '../ui/Form';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import { retryQuery } from '#lib/utils/retry-query.js';

	/** Lends a location and every unit in it, nested locations included, as one kit (#2725). */
	const { fields } = checkOutKit;

	let {
		variant = 'default',
		size = 'sm'
	}: {
		variant?: ButtonVariant;
		size?: ButtonSize;
	} = $props();

	let userId = $state('');
	let userName = $state('');
</script>

<Action
	action={checkOutKit}
	label={m.actions_check_out_kit_label()}
	modalTitle={m.actions_check_out_kit_modal_title()}
	successToast={m.actions_check_out_kit_success_toast()}
	{variant}
	{size}
	onsuccess={(result) => {
		const id = (result as { kitLoanId?: string } | undefined)?.kitLoanId;
		if (id) void goto(resolve('/staff/inventory/kits/[id]', { id }));
	}}
>
	{#snippet form()}
		<svelte:boundary>
			<div class="space-y-3">
				<Field
					field={fields.locationId}
					type="select"
					label={m.staff_location_label()}
					placeholder={m.actions_check_out_kit_placeholder()}
					value=""
					options={(await getLocations()).map((l) => ({ value: l.id, label: l.name }))}
				/>
				<MemberPicker field={fields.userId} bind:value={userId} bind:name={userName} />
				<Field
					field={fields.dueDate}
					type="date"
					label={m.actions_check_out_kit_due_date_label()}
				/>
				<Field field={fields.notes} type="textarea" label={m.staff_notes_label()} />
			</div>

			{#snippet pending()}
				<div class="flex items-center justify-center p-8">
					<span class="loading loading-md loading-spinner"></span>
				</div>
			{/snippet}

			{#snippet failed(error, reset)}
				<Alert type="warning" reset={() => retryQuery(getLocations(), reset)}>
					{errorMessage(error)}
				</Alert>
			{/snippet}
		</svelte:boundary>
	{/snippet}
</Action>
