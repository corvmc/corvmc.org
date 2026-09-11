<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { IconFlag } from '@tabler/icons-svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { submitFlag } from '$lib/remote/flags.remote';
	import type { MemberReportableEntityType } from '$lib/server/db/schema/flag';

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
	label="Report"
	modalTitle={entityLabel ? `Report ${entityLabel}` : 'Report content'}
	submitLabel="Submit report"
	successToast="Report submitted — thank you"
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
				Let staff know what's wrong with this content. Reports are private and reviewed by the CMC
				team.
			</p>
			<!-- Custom inputs rather than FormField's own: both keep `bind:value`,
			     which `canSubmit` and the post-success reset read, and the textarea
			     keeps its rows and length cap. The wrapper is here for the error
			     slot — a rejected report whose message never renders reads as a
			     submit that did nothing. -->
			<FormField field={fields.reason} label="Reason">
				{#snippet input(id)}
					<input
						{...fields.reason.as('text')}
						{id}
						class="input w-full"
						bind:value={reason}
						maxlength="100"
						placeholder="e.g. Inappropriate content, impersonation, spam"
					/>
				{/snippet}
			</FormField>
			<FormField field={fields.description} label="Details (optional)">
				{#snippet input(id)}
					<textarea
						{...fields.description.as('text')}
						{id}
						class="textarea w-full"
						rows="3"
						maxlength="1000"
						bind:value={description}
						placeholder="Anything else that would help us review this"></textarea>
				{/snippet}
			</FormField>
		</div>
	{/snippet}
</Action>
