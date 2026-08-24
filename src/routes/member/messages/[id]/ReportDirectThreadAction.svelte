<script lang="ts">
	import Action from '$lib/components/shared/Action.svelte';
	import { IconFlag } from '@tabler/icons-svelte';
	import { reportDirectThread } from '$lib/remote/direct-messages.remote';

	// A sibling of ReportContentAction rather than a use of it. The shared one
	// posts to submitFlag, which takes its entity type and id from the browser
	// and checks nothing about the reporter — fine for a public profile, wrong
	// for a private conversation, since filing the report is what makes the
	// conversation readable by staff. This posts to a remote that verifies the
	// reporter is in the conversation first.
	let { threadId }: { threadId: string } = $props();

	const { fields } = reportDirectThread;

	let reason = $state('');
	let description = $state('');
</script>

<Action
	action={reportDirectThread}
	label="Report"
	modalTitle="Report this conversation"
	submitLabel="Submit report"
	successToast="Report submitted — thank you"
	variant="ghost"
	size="sm"
	canSubmit={reason.trim().length > 0}
	onsuccess={() => {
		reason = '';
		description = '';
	}}
>
	{#snippet icon()}<IconFlag size={16} />{/snippet}
	{#snippet form()}
		<input {...fields.threadId.as('hidden', threadId)} />
		<div class="space-y-3">
			<p class="text-muted">
				Staff will be able to read this conversation so they can review it. This person will also be
				blocked, and the conversation will close.
			</p>
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Reason</span></div>
				<input
					{...fields.reason.as('text')}
					class="input w-full"
					bind:value={reason}
					maxlength="100"
					placeholder="e.g. Harassment, spam, impersonation"
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
