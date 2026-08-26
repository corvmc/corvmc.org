<script lang="ts">
	import AudiencePicker from '../AudiencePicker.svelte';
	import CampaignPreview from '../CampaignPreview.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import { createDraft, createAndSend, createAndSchedule } from '$lib/remote/marketing.remote';

	let subject = $state('');
	let markdownBody = $state('');
	let selectedAudienceIds = $state<string[]>([]);
	let scheduledFor = $state('');
	let submitting = $state(false);

	// Written back by AudiencePicker, which owns the audience query.
	let totalSubscribers = $state(0);

	async function handleSaveDraft() {
		if (!isValid()) return;
		submitting = true;
		try {
			const result = await createDraft({
				subject: subject.trim(),
				markdownBody,
				audienceIds: selectedAudienceIds
			});
			toast.success('Draft saved');
			goto(resolve(`/staff/marketing/campaigns/${result?.campaignId}/edit`));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save');
		} finally {
			submitting = false;
		}
	}

	async function handleSendNow() {
		if (!isValid()) return;
		if (!window.confirm(`Send to approximately ${totalSubscribers} recipients now?`)) return;
		submitting = true;
		try {
			const result = await createAndSend({
				subject: subject.trim(),
				markdownBody,
				audienceIds: selectedAudienceIds
			});
			toast.success('Campaign sent');
			goto(resolve(`/staff/marketing/campaigns/${result?.campaignId}`));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to send');
		} finally {
			submitting = false;
		}
	}

	async function handleSchedule() {
		if (!isValid() || !isFutureSchedule()) return;
		submitting = true;
		try {
			const result = await createAndSchedule({
				subject: subject.trim(),
				markdownBody,
				audienceIds: selectedAudienceIds,
				scheduledFor: new Date(scheduledFor).toISOString()
			});
			toast.success('Campaign scheduled');
			goto(resolve(`/staff/marketing/campaigns/${result?.campaignId}`));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to schedule');
		} finally {
			submitting = false;
		}
	}

	function isValid() {
		return subject.trim() && markdownBody.trim() && selectedAudienceIds.length > 0;
	}

	// The service rejects a past date with a bare Error, which would surface as a
	// raw toast — catch it here while the field is still in front of the user.
	function isFutureSchedule() {
		return !!scheduledFor && new Date(scheduledFor).getTime() > Date.now();
	}
</script>

<PageHeader title="New Campaign" subtitle="Marketing" backHref="/staff/marketing/campaigns" />
<PageContent>
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- Editor pane -->
		<div class="space-y-4">
			<div>
				<label for="campaign-subject" class="label text-sm font-medium">Subject</label>
				<input
					id="campaign-subject"
					type="text"
					bind:value={subject}
					placeholder="Email subject line..."
					class="input w-full"
				/>
			</div>

			<div>
				<p class="label text-sm font-medium">Audiences</p>
				<AudiencePicker bind:selected={selectedAudienceIds} bind:total={totalSubscribers} />
			</div>

			<div>
				<label for="campaign-body" class="label text-sm font-medium">Body (Markdown)</label>
				<textarea
					id="campaign-body"
					bind:value={markdownBody}
					placeholder="Write your email in markdown..."
					class="textarea w-full font-mono text-sm"
					rows="20"
				></textarea>
				<p class="text-subtle mt-1">
					Available variables: {'{{subscriber_name}}'}, {'{{unsubscribe_url}}'}
				</p>
			</div>

			<div>
				<label for="campaign-schedule" class="label text-sm font-medium">
					Schedule for later (optional)
				</label>
				<input
					id="campaign-schedule"
					type="datetime-local"
					bind:value={scheduledFor}
					class="input w-full"
				/>
				{#if scheduledFor && !isFutureSchedule()}
					<p class="mt-1 text-xs text-error">Pick a time in the future.</p>
				{/if}
			</div>

			<!-- Actions -->
			<div class="flex flex-wrap gap-2">
				<Button
					variant="default"
					size="sm"
					outline
					disabled={!isValid() || submitting}
					onclick={handleSaveDraft}
				>
					Save Draft
				</Button>
				<Button
					variant="secondary"
					size="sm"
					disabled={!isValid() || !isFutureSchedule() || submitting}
					onclick={handleSchedule}
				>
					Schedule
				</Button>
				<Button
					variant="primary"
					size="sm"
					disabled={!isValid() || submitting}
					onclick={handleSendNow}
				>
					Send Now
				</Button>
			</div>

			{#if submitting}
				<div class="flex items-center gap-2 text-muted">
					<span class="loading loading-sm loading-spinner"></span>
					Working...
				</div>
			{/if}
		</div>

		<!-- Preview pane -->
		<div>
			<p class="label text-sm font-medium">Preview</p>
			<CampaignPreview markdown={markdownBody} />
		</div>
	</div>
</PageContent>
