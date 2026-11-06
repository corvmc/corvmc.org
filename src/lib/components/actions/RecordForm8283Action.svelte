<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { utcCalendarDate } from '#lib/utils/format.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { recordForm8283 } from '#lib/remote/inventory.remote.js';
	import { Field } from '../ui/Form';

	const { fields } = recordForm8283;

	let {
		acquisitionId,
		signedOn,
		appraisalRef,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		acquisitionId: string;
		signedOn?: Date | null;
		appraisalRef?: string | null;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={recordForm8283}
	data-testid="record-8283"
	label={signedOn ? m.actions_record_form8283_edit_8283() : m.actions_record_form8283_record_8283()}
	modalTitle={m.actions_record_form8283_modal_title()}
	successToast={m.actions_record_form8283_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', acquisitionId)} />
		<div class="mb-3 rounded bg-base-200 p-3 text-sm">
			<p>
				{m.actions_record_form8283_donor_claiming_deduction_over_5()}
			</p>
			<!-- Not bookkeeping for its own sake: this is the fact that decides
			     whether disposing of the gift later obliges a Form 8282 filing.
			     Without it recorded, that warning stays silent. -->
			<p class="mt-1 opacity-70">
				{m.actions_record_form8283_what_makes_gift_reportable_if()}
			</p>
		</div>
		<Field
			field={fields.signedOn}
			type="date"
			label={m.actions_record_form8283_signed()}
			value={signedOn ? utcCalendarDate(signedOn) : ''}
		/>
		<Field
			field={fields.appraisalRef}
			type="text"
			label={m.actions_record_form8283_appraisal_reference_optional()}
			description={m.actions_record_form8283_description()}
			value={appraisalRef ?? ''}
		/>
	{/snippet}
</Action>
