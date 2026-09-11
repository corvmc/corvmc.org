<script lang="ts">
	import AudiencePicker from '../../AudiencePicker.svelte';
	import CampaignPreview from '../../CampaignPreview.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { errorMessage } from '$lib/error-message';
	import {
		getCampaignDetail,
		saveDraft,
		sendCampaignNow,
		scheduleCampaign,
		deleteCampaign
	} from '$lib/remote/marketing.remote';

	let id = $derived(page.params.id!);
	let campaignData = $derived(await getCampaignDetail(id));

	// Initialize editable state from loaded campaign
	let subject = $state('');
	let markdownBody = $state('');
	let selectedAudienceIds = $state<string[]>([]);
	let scheduledFor = $state('');
	let submitting = $state(false);
	let initialized = $state(false);
	let confirmingSend = $state(false);
	let confirmingDelete = $state(false);

	$effect(() => {
		if (campaignData && !initialized) {
			subject = campaignData.subject;
			markdownBody = campaignData.markdownBody;
			selectedAudienceIds = campaignData.audiences.map((a) => a.id);
			initialized = true;
		}
	});

	// Redirect if not a draft
	$effect(() => {
		if (campaignData && campaignData.status !== 'draft') {
			goto(resolve(`/staff/marketing/campaigns/${id}`));
		}
	});

	// Written back by AudiencePicker, which owns the audience query.
	let totalSubscribers = $state(0);

	function isValid() {
		return subject.trim() && markdownBody.trim() && selectedAudienceIds.length > 0;
	}

	// The service rejects a past date with a bare Error, which would surface as a
	// raw toast — catch it here while the field is still in front of the user.
	function isFutureSchedule() {
		return !!scheduledFor && new Date(scheduledFor).getTime() > Date.now();
	}

	async function handleSave() {
		if (!isValid()) return;
		submitting = true;
		try {
			await saveDraft({
				subject: subject.trim(),
				markdownBody,
				audienceIds: selectedAudienceIds
			});
			toast.success('Draft saved');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save');
		} finally {
			submitting = false;
		}
	}

	/**
	 * Ask before saving, not after: the old order saved the draft and *then* put
	 * up the dialog, so cancelling still wrote the edits. A named submit rather
	 * than a browser OK, for the one action here with no recall (#989).
	 */
	function handleSendNow() {
		if (!isValid()) return;
		confirmingSend = true;
	}

	async function sendNow() {
		confirmingSend = false;
		submitting = true;
		try {
			// Save first: `sendCampaignNow` sends what is stored, so unsaved edits
			// would otherwise go out with the old copy.
			await saveDraft({
				subject: subject.trim(),
				markdownBody,
				audienceIds: selectedAudienceIds
			});
			await sendCampaignNow({});
		} catch (err) {
			// The try covers the calls and nothing else, and a remote rejection is
			// not an `Error` — reading `.message` off one always fell through to
			// "Failed to send", whatever actually went wrong (#988).
			toast.error(errorMessage(err));
			submitting = false;
			return;
		}
		toast.success('Campaign sent');
		goto(resolve(`/staff/marketing/campaigns/${id}`));
	}

	async function handleSchedule() {
		if (!isValid() || !isFutureSchedule()) return;
		submitting = true;
		try {
			// Save first: `scheduleCampaign` only sets the date, so unsaved edits
			// would otherwise go out with the old copy.
			await saveDraft({
				subject: subject.trim(),
				markdownBody,
				audienceIds: selectedAudienceIds
			});
			await scheduleCampaign({ scheduledFor: new Date(scheduledFor).toISOString() });
			toast.success('Campaign scheduled');
			goto(resolve(`/staff/marketing/campaigns/${id}`));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to schedule');
		} finally {
			submitting = false;
		}
	}

	function handleDelete() {
		confirmingDelete = true;
	}

	async function deleteNow() {
		confirmingDelete = false;
		try {
			await deleteCampaign({});
			toast.success('Campaign deleted');
			goto(resolve('/staff/marketing/campaigns'));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
		}
	}
</script>

<PageHeader title="Edit Campaign" subtitle="Marketing" backHref="/staff/marketing/campaigns">
	<Button variant="ghost" size="sm" class="text-error" onclick={handleDelete}>Delete</Button>
</PageHeader>
<PageContent>
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
					rows="20"></textarea>
				<p class="mt-1 text-subtle">
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

			<div class="flex flex-wrap gap-2">
				<Button
					variant="default"
					size="sm"
					outline
					disabled={!isValid() || submitting}
					onclick={handleSave}
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

<Modal bind:open={confirmingSend} title="Send this campaign now?">
	<p>
		This goes to <strong>{totalSubscribers}</strong>
		{totalSubscribers === 1 ? 'person' : 'people'} immediately, as
		<em>{subject.trim() || 'an untitled campaign'}</em>.
	</p>
	<p class="mt-2 text-muted">There is no recall.</p>
	<div class="modal-action">
		<Button variant="default" size="sm" outline onclick={() => (confirmingSend = false)}>
			Not yet
		</Button>
		<Button variant="primary" size="sm" onclick={sendNow}>
			Send to {totalSubscribers}
			{totalSubscribers === 1 ? 'person' : 'people'}
		</Button>
	</div>
</Modal>

<Modal bind:open={confirmingDelete} title="Delete this draft?">
	<p>
		<em>{subject.trim() || 'This untitled campaign'}</em> and its audience selection go with it.
	</p>
	<div class="modal-action">
		<Button variant="default" size="sm" outline onclick={() => (confirmingDelete = false)}>
			Keep it
		</Button>
		<Button variant="error" size="sm" onclick={deleteNow}>Delete the draft</Button>
	</div>
</Modal>
