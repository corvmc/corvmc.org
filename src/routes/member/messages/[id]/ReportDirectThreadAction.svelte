<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { IconFlag } from '@tabler/icons-svelte';
	import { reportDirectThread } from '#lib/remote/direct-messages.remote.js';

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
	label={m.member_report()}
	modalTitle={m.member_messages_id_report_direct_thread_modal_title()}
	submitLabel={m.member_messages_id_report_direct_thread_submit_label()}
	successToast={m.member_messages_id_report_direct_thread_success_toast()}
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
				{m.member_messages_id_report_direct_thread_staff_will_able_read()}
			</p>
			<label class="fieldset w-full">
				<span class="fieldset-legend">{m.member_messages_id_report_direct_thread_reason()}</span>
				<input
					{...fields.reason.as('text')}
					class="input w-full"
					bind:value={reason}
					maxlength="100"
					placeholder={m.member_messages_id_report_direct_thread_e_g_harassment_spam()}
				/>
			</label>
			<label class="fieldset w-full">
				<span class="fieldset-legend"
					>{m.member_messages_id_report_direct_thread_details_optional()}</span
				>
				<textarea
					{...fields.description.as('text')}
					class="textarea w-full"
					rows="3"
					maxlength="1000"
					bind:value={description}
					placeholder={m.member_messages_id_report_direct_thread_anything_else_would()}></textarea>
			</label>
		</div>
	{/snippet}
</Action>
