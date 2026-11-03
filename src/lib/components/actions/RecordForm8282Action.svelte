<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { recordForm8282 } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';
	import { toLocalDate } from '$lib/utils/format';

	const { fields } = recordForm8282;

	let {
		assetId,
		dueBy,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		assetId: string;
		dueBy?: Date | null;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={recordForm8282}
	label={m.actions_record_form8282_record_8282()}
	modalTitle={m.actions_record_form8282_modal_title()}
	successToast={m.actions_recorded()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', assetId)} />
		<div class="mb-3 rounded bg-base-200 p-3 text-sm">
			<p>
				{m.actions_record_form8282_unit_was_donated_disposed_within()}{#if dueBy}, by
					<strong>{toLocalDate(dueBy)}</strong>{/if}.
			</p>
			<!-- The system cannot decide this. Whether it is reportable turns on
			     whether the donor filed a Form 8283 that CMC signed, which is a fact
			     about paperwork rather than about stock. -->
			<p class="mt-1 opacity-70">
				{m.actions_record_form8282_record_either_was_filed_no()}
			</p>
		</div>
		<Field
			field={fields.note}
			type="textarea"
			label={m.actions_record_form8282_what_happened()}
			description={m.actions_record_form8282_description()}
		/>
	{/snippet}
</Action>
