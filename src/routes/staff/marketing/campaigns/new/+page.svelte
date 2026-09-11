<script lang="ts">
	import AudiencePicker from '../AudiencePicker.svelte';
	import CampaignPreview from '../CampaignPreview.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { errorMessage } from '$lib/error-message';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { createDraft, createAndSend, createAndSchedule } from '$lib/remote/marketing.remote';

	let subject = $state('');
	let markdownBody = $state('');
	let selectedAudienceIds = $state<string[]>([]);
	let scheduledFor = $state('');
	let submitting = $state(false);

	// Written back by AudiencePicker, which owns the audience query.
	let totalSubscribers = $state(0);

	let confirmingSend = $state(false);

	/**
	 * The `try` covers the call and nothing else. Wrapping the toast and the
	 * navigation too reported a post-success failure as a send failure, on the
	 * one action here that cannot be undone. `submitting` also stays set after
	 * a success, so the button cannot invite a second send while the navigation
	 * is in flight (#988).
	 */
	async function submit(
		call: () => Promise<{ campaignId: string } | undefined>,
		done: string,
		to: (id: string) => string
	) {
		submitting = true;
		let result: { campaignId: string } | undefined;
		try {
			result = await call();
		} catch (err) {
			// Remote rejections are not `Error`s — reading `.message` off one
			// yields undefined, which is how every failure here read "Failed to".
			toast.error(errorMessage(err));
			submitting = false;
			return;
		}
		toast.success(done);
		if (result?.campaignId) goto(to(result.campaignId));
	}

	function handleSaveDraft() {
		if (!isValid()) return;
		return submit(
			() =>
				createDraft({ subject: subject.trim(), markdownBody, audienceIds: selectedAudienceIds }),
			'Draft saved',
			(id) => resolve(`/staff/marketing/campaigns/${id}/edit`)
		);
	}

	/**
	 * Two steps, because this is the one action in the app that cannot be undone
	 * and it was the one confirmed by `window.confirm` — whose button says OK.
	 * Every other consequential act here names itself on the submit: Send the
	 * offer, Delete permanently, Drop out (#989).
	 */
	function handleSendNow() {
		if (!isValid()) return;
		confirmingSend = true;
	}

	function sendNow() {
		confirmingSend = false;
		return submit(
			() =>
				createAndSend({ subject: subject.trim(), markdownBody, audienceIds: selectedAudienceIds }),
			'Campaign sent',
			(id) => resolve(`/staff/marketing/campaigns/${id}`)
		);
	}

	function handleSchedule() {
		if (!isValid() || !isFutureSchedule()) return;
		return submit(
			() =>
				createAndSchedule({
					subject: subject.trim(),
					markdownBody,
					audienceIds: selectedAudienceIds,
					scheduledFor: new Date(scheduledFor).toISOString()
				}),
			'Campaign scheduled',
			(id) => resolve(`/staff/marketing/campaigns/${id}`)
		);
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

<Modal bind:open={confirmingSend} title="Send this campaign now?">
	<p>
		This goes to <strong>{totalSubscribers}</strong>
		{totalSubscribers === 1 ? 'person' : 'people'} immediately, as
		<em>{subject.trim() || 'an untitled campaign'}</em>.
	</p>
	<p class="mt-2 text-muted">
		There is no recall. If you are not sure, save it as a draft and send it from the campaign page
		once you have read it back.
	</p>
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
