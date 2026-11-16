<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { recordForm8282 } from '#lib/remote/inventory.remote.js';
	import { Field } from '../ui/Form';
	import { toLocalDate } from '#lib/utils/format.js';

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
	label={m.actions_record_form8282_record_8282_label()}
	modalTitle={m.actions_record_form8282_modal_title()}
	successToast={m.actions_recorded_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', assetId)} />
		<div class="mb-3 rounded bg-base-200 p-3 text-sm">
			<p>
				{m.actions_record_form8282_unit_was_donated_disposed_within_text()}{#if dueBy}<ParaglideMessage
						message={m.actions_record_form8282_by_text}
						inputs={{ toLocalDate: toLocalDate(dueBy) }}
						>{#snippet strong({ children })}<strong>{@render children?.()}</strong
							>{/snippet}</ParaglideMessage
					>{/if}.
			</p>
			<!-- The system cannot decide this. Whether it is reportable turns on
			     whether the donor filed a Form 8283 that CMC signed, which is a fact
			     about paperwork rather than about stock. -->
			<p class="mt-1 opacity-70">
				{m.actions_record_form8282_record_either_was_filed_no_text()}
			</p>
		</div>
		<Field
			field={fields.note}
			type="textarea"
			label={m.actions_record_form8282_what_happened_label()}
			description={m.actions_record_form8282_description_body()}
		/>
	{/snippet}
</Action>
