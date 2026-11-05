<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { IconFlag } from '@tabler/icons-svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { submitFlag } from '#lib/remote/flags.remote.js';
	import type { MemberReportableEntityType } from '#lib/server/db/schema/flag.js';

	let {
		entityType,
		entityId,
		entityLabel,
		variant = 'ghost',
		size = 'sm',
		class: className = '',
		...rest
	}: {
		// Narrowed: a conversation is reported through ReportDirectThreadAction,
		// which goes via a remote that checks the reporter is in it.
		entityType: MemberReportableEntityType;
		entityId: string;
		entityLabel?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		[key: string]: unknown;
	} = $props();

	const { fields } = submitFlag;

	let reason = $state('');
	let description = $state('');
</script>

<Action
	action={submitFlag}
	label={m.actions_report()}
	modalTitle={entityLabel
		? m.actions_report_content_report({ entityLabel })
		: m.actions_report_content_report_content()}
	submitLabel={m.actions_submit_report()}
	successToast={m.actions_report_submitted_thank()}
	{variant}
	{size}
	class={className}
	canSubmit={reason.trim().length > 0}
	onsuccess={() => {
		reason = '';
		description = '';
	}}
	{...rest}
>
	{#snippet icon()}<IconFlag size={16} />{/snippet}
	{#snippet form()}
		<input {...fields.entityType.as('hidden', entityType)} />
		<input {...fields.entityId.as('hidden', entityId)} />
		<div class="space-y-3">
			<p class="text-muted">
				{m.actions_report_content_let_staff_know_what_s()}
			</p>
			<!-- Custom inputs rather than FormField's own: both keep `bind:value`,
			     which `canSubmit` and the post-success reset read, and the textarea
			     keeps its rows and length cap. The wrapper is here for the error
			     slot — a rejected report whose message never renders reads as a
			     submit that did nothing. -->
			<FormField field={fields.reason} label={m.actions_reason()}>
				{#snippet input(id)}
					<input
						{...fields.reason.as('text')}
						{id}
						class="input w-full"
						bind:value={reason}
						maxlength="100"
						placeholder={m.actions_report_content_e_g_inappropriate_content_impersonati()}
					/>
				{/snippet}
			</FormField>
			<FormField field={fields.description} label={m.actions_details_optional()}>
				{#snippet input(id)}
					<textarea
						{...fields.description.as('text')}
						{id}
						class="textarea w-full"
						rows="3"
						maxlength="1000"
						bind:value={description}
						placeholder={m.actions_anything_else_would_help_us()}></textarea>
				{/snippet}
			</FormField>
		</div>
	{/snippet}
</Action>
