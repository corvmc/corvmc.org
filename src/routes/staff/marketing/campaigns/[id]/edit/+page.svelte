<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import {
		getCampaignDetail,
		getAudienceOptions,
		getPreview,
		saveDraft,
		sendCampaignNow,
		scheduleCampaign,
		deleteCampaign
	} from '$lib/remote/marketing.remote';

	let id = $derived(page.params.id!);
	let campaignData = $derived(await getCampaignDetail(id));
	let audiences = $derived(await getAudienceOptions());

	// Initialize editable state from loaded campaign
	let subject = $state('');
	let markdownBody = $state('');
	let selectedAudienceIds = $state<string[]>([]);
	let scheduledFor = $state('');
	let submitting = $state(false);
	let initialized = $state(false);

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

	let previewHtml = $derived(await getPreview(markdownBody));

	function toggleAudience(audienceId: string) {
		if (selectedAudienceIds.includes(audienceId)) {
			selectedAudienceIds = selectedAudienceIds.filter((a) => a !== audienceId);
		} else {
			selectedAudienceIds = [...selectedAudienceIds, audienceId];
		}
	}

	let totalSubscribers = $derived(
		audiences
			.filter((a) => selectedAudienceIds.includes(a.id))
			.reduce((sum, a) => sum + a.subscriberCount, 0)
	);

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

	async function handleSendNow() {
		if (!isValid()) return;
		// Save first, then send
		submitting = true;
		try {
			await saveDraft({
				subject: subject.trim(),
				markdownBody,
				audienceIds: selectedAudienceIds
			});
			if (!window.confirm(`Send to approximately ${totalSubscribers} recipients now?`)) {
				submitting = false;
				return;
			}
			await sendCampaignNow({});
			toast.success('Campaign sent');
			goto(resolve(`/staff/marketing/campaigns/${id}`));
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

	async function handleDelete() {
		if (!window.confirm('Delete this draft campaign?')) return;
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
				<div class="flex flex-wrap gap-2">
					{#each audiences as a (a.id)}
						<label
							class="label cursor-pointer gap-2 border rounded-lg px-3 py-1.5 {selectedAudienceIds.includes(
								a.id
							)
								? 'border-primary bg-primary/10'
								: 'border-base-300'}"
						>
							<input
								type="checkbox"
								class="checkbox checkbox-sm checkbox-primary"
								checked={selectedAudienceIds.includes(a.id)}
								onchange={() => toggleAudience(a.id)}
							/>
							<span class="text-sm">{a.name}</span>
							{#if a.systemKey}
								<span class="badge badge-info badge-xs">Built-in</span>
							{/if}
							<span class="text-subtle">({a.subscriberCount})</span>
						</label>
					{/each}
				</div>
				{#if selectedAudienceIds.length > 0}
					<p class="text-subtle mt-1">
						~{totalSubscribers} recipients (before deduplication)
					</p>
				{/if}
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
			<div class="border rounded-lg bg-white overflow-hidden" style="min-height: 400px;">
				{#if previewHtml}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (admin campaign HTML preview) -->
					{@html previewHtml}
				{:else}
					<div class="flex items-center justify-center h-full p-12 text-sm opacity-40">
						Start typing to see a preview...
					</div>
				{/if}
			</div>
		</div>
	</div>
</PageContent>
