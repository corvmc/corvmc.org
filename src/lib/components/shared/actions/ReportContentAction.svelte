<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { IconFlag } from '@tabler/icons-svelte';
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
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Reason</span></div>
				<input
					{...fields.reason.as('text')}
					class="input w-full"
					bind:value={reason}
					maxlength="100"
					placeholder="e.g. Inappropriate content, impersonation, spam"
				/>
			</label>
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Details (optional)</span></div>
				<textarea
					{...fields.description.as('text')}
					class="textarea w-full"
					rows="3"
					maxlength="1000"
					bind:value={description}
					placeholder="Anything else that would help us review this"
				></textarea>
			</label>
		</div>
	{/snippet}
</Action>
