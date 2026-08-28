<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { recordForm8283 } from '$lib/remote/inventory.remote';
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
	label={signedOn ? 'Edit 8283' : 'Record 8283'}
	modalTitle="Record the Form 8283"
	successToast="Acknowledgment recorded"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', acquisitionId)} />
		<div class="mb-3 rounded bg-base-200 p-3 text-sm">
			<p>
				A donor claiming a deduction over $5,000 asks the collective to sign their Form 8283. Record
				that here once it is signed.
			</p>
			<!-- Not bookkeeping for its own sake: this is the fact that decides
			     whether disposing of the gift later obliges a Form 8282 filing.
			     Without it recorded, that warning stays silent. -->
			<p class="mt-1 opacity-70">
				This is what makes the gift reportable if it is later sold or disposed of within three years
				— leave it unrecorded and no Form 8282 warning will ever be raised for it.
			</p>
		</div>
		<Field
			field={fields.signedOn}
			type="date"
			label="Signed on"
			value={signedOn ? signedOn.toISOString().slice(0, 10) : ''}
		/>
		<Field
			field={fields.appraisalRef}
			type="text"
			label="Appraisal reference (optional)"
			description="Gifts over $5,000 need a qualified appraisal. Note where it is filed."
			value={appraisalRef ?? ''}
		/>
	{/snippet}
</Action>
