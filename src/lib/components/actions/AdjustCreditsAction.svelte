<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { refreshAll } from '$app/navigation';
	import { adjustCredits } from '#lib/remote/users.remote.js';

	let {
		userId,
		variant = 'default',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		amountHint,
		...rest
	}: {
		userId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: () => void;
		/** Under Amount: what a comp-only caller may add. */
		amountHint?: string;
		[key: string]: unknown;
	} = $props();

	const { fields } = adjustCredits;

	let creditType = $state<'free_hours' | 'equipment_credits'>('free_hours');
	let amount = $state(0);
	let description = $state('');
</script>

<Action
	action={adjustCredits}
	label={m.actions_adjust_credits_adjust_label()}
	modalTitle={m.actions_adjust_credits_modal_title()}
	successToast={m.actions_adjust_credits_success_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	canSubmit={amount !== 0 && description.trim().length > 0}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.userId.as('hidden', userId)} />
		<div class="space-y-3">
			<!-- FormField in custom-input mode: the inputs keep their own
			     `fields.*.as(...)` spreads so what gets submitted is unchanged, but
			     the wrapper supplies the error slot. Without it, a field issue from
			     the server sets aria-invalid and renders no message at all — which
			     is what happened to the over-deduction message before. -->
			<FormField field={fields.creditType} label={m.actions_adjust_credits_credit_type_label()}>
				<Select class="w-full" {...fields.creditType.as('select')} bind:value={creditType}>
					<option value="free_hours">{m.actions_adjust_credits_free_hours_label()}</option>
					<option value="equipment_credits"
						>{m.actions_adjust_credits_equipment_credits_label()}</option
					>
				</Select>
			</FormField>
			<FormField
				field={fields.amount}
				label={creditType === 'free_hours'
					? m.actions_adjust_credits_hours_label()
					: m.actions_adjust_credits_credits_label()}
				description={amountHint}
			>
				<input
					{...fields.amount.as('text')}
					type="number"
					step={creditType === 'free_hours' ? 0.5 : 1}
					class="input w-full"
					bind:value={amount}
					placeholder={m.actions_adjust_credits_positive_add_negative_deduct_placeholder()}
				/>
			</FormField>
			<FormField field={fields.description} label={m.actions_reason_label()}>
				<input
					{...fields.description.as('text')}
					class="input w-full"
					bind:value={description}
					placeholder={m.actions_adjust_credits_why_adjustment_being_made_placeholder()}
				/>
			</FormField>
		</div>
	{/snippet}
</Action>
