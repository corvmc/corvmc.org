<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import AudiencePicker from '../../AudiencePicker.svelte';
	import EventScopePicker from '../../EventScopePicker.svelte';
	import CampaignPreview from '../../CampaignPreview.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import {
		getCampaignDetail,
		saveDraft,
		sendCampaignNow,
		scheduleCampaign,
		deleteCampaign
	} from '#lib/remote/marketing.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	let id = $derived(params.id);
	let campaignData = $derived(await getCampaignDetail(id));

	// Initialize editable state from loaded campaign
	let subject = $state('');
	let markdownBody = $state('');
	let selectedAudienceIds = $state<string[]>([]);
	let eventId = $state('');
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
			eventId = campaignData.eventId ?? '';
			initialized = true;
		}
	});

	// Redirect if not a draft
	$effect(() => {
		if (campaignData && campaignData.status !== 'draft') {
			goto(resolve(`staff/marketing/campaigns/${id}`));
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
				audienceIds: selectedAudienceIds,
				eventId
			});
			toast.success(m.staff_marketing_campaigns_id_edit_draft_saved_toast());
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : m.staff_marketing_campaigns_id_edit_failed_save_toast()
			);
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
				audienceIds: selectedAudienceIds,
				eventId
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
		toast.success(m.staff_marketing_campaigns_id_edit_campaign_sent_toast());
		goto(resolve(`staff/marketing/campaigns/${id}`));
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
				audienceIds: selectedAudienceIds,
				eventId
			});
			await scheduleCampaign({ scheduledFor: new Date(scheduledFor).toISOString() });
			toast.success(m.staff_marketing_campaigns_id_edit_campaign_scheduled_toast());
			goto(resolve(`staff/marketing/campaigns/${id}`));
		} catch (err) {
			toast.error(
				err instanceof Error
					? err.message
					: m.staff_marketing_campaigns_id_edit_failed_schedule_toast()
			);
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
			toast.success(m.staff_marketing_campaigns_id_edit_campaign_deleted_toast());
			goto(resolve('staff/marketing/campaigns'));
		} catch (err) {
			toast.error(
				err instanceof Error
					? err.message
					: m.staff_marketing_campaigns_id_edit_failed_delete_toast()
			);
		}
	}
</script>

<PageHeader
	title={m.staff_marketing_campaigns_id_edit_edit_campaign_title()}
	subtitle={m.staff_marketing_body()}
>
	<Button variant="ghost" size="sm" class="text-error" onclick={handleDelete}
		>{m.staff_delete_label()}</Button
	>
</PageHeader>
<PageContent>
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<!-- Editor pane -->
		<div class="space-y-4">
			<div>
				<label for="campaign-subject" class="label text-sm font-medium"
					>{m.staff_subject_label()}</label
				>
				<input
					id="campaign-subject"
					type="text"
					bind:value={subject}
					placeholder={m.staff_email_subject_line_placeholder()}
					class="input w-full"
				/>
			</div>

			<div>
				<p class="label text-sm font-medium">{m.staff_audiences_text()}</p>
				<AudiencePicker bind:selected={selectedAudienceIds} bind:total={totalSubscribers} />
			</div>

			<div>
				<p class="label text-sm font-medium">{m.staff_about_show_text()}</p>
				<EventScopePicker initial={campaignData.event} onchange={(id) => (eventId = id)} />
			</div>

			<div>
				<label for="campaign-body" class="label text-sm font-medium"
					>{m.staff_body_markdown_label()}</label
				>
				<textarea
					id="campaign-body"
					bind:value={markdownBody}
					placeholder={m.staff_write_email_markdown_placeholder()}
					class="textarea w-full font-mono text-sm"
					rows="20"></textarea>
				<p class="mt-1 text-subtle">
					{m.staff_marketing_campaigns_available_variables_text({
						first: '{{subscriber_name}}',
						second: '{{unsubscribe_url}}'
					})}
				</p>
			</div>

			<div>
				<label for="campaign-schedule" class="label text-sm font-medium">
					{m.staff_schedule_later_optional_label()}
				</label>
				<input
					id="campaign-schedule"
					type="datetime-local"
					bind:value={scheduledFor}
					class="input w-full"
				/>
				{#if scheduledFor && !isFutureSchedule()}
					<p class="mt-1 text-xs text-error">{m.staff_pick_time_future_text()}</p>
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
					{m.staff_save_draft_label()}
				</Button>
				<Button
					variant="secondary"
					size="sm"
					disabled={!isValid() || !isFutureSchedule() || submitting}
					onclick={handleSchedule}
				>
					{m.staff_schedule_label()}
				</Button>
				<Button
					variant="primary"
					size="sm"
					disabled={!isValid() || submitting}
					onclick={handleSendNow}
				>
					{m.staff_send_now_label()}
				</Button>
			</div>

			{#if submitting}
				<div class="flex items-center gap-2 text-muted">
					<ParaglideMessage message={m.staff_working_text} inputs={{}}
						>{#snippet span({ children })}<span class="loading loading-sm loading-spinner"
								>{@render children?.()}</span
							>{/snippet}</ParaglideMessage
					>
				</div>
			{/if}
		</div>

		<!-- Preview pane -->
		<div>
			<p class="label text-sm font-medium">{m.staff_preview_text()}</p>
			<CampaignPreview markdown={markdownBody} />
		</div>
	</div>
</PageContent>

<Modal bind:open={confirmingSend} title={m.staff_send_campaign_now_title()}>
	<p>
		<ParaglideMessage
			message={m.staff_goes_people_immediately_as_text}
			inputs={{
				totalSubscribers,
				trim: subject.trim() || m.staff_marketing_campaigns_id_edit_untitled_campaign_text()
			}}
			>{#snippet strong({ children })}<strong>{@render children?.()}</strong
				>{/snippet}{#snippet em({ children })}<em>{@render children?.()}</em
				>{/snippet}</ParaglideMessage
		>
	</p>
	<p class="mt-2 text-muted">{m.staff_marketing_campaigns_id_edit_there_no_recall_text()}</p>
	<div class="modal-action">
		<Button variant="default" size="sm" outline onclick={() => (confirmingSend = false)}>
			{m.staff_not_yet_label()}
		</Button>
		<Button variant="primary" size="sm" onclick={sendNow}>
			{m.staff_send_people_label({ totalSubscribers })}
		</Button>
	</div>
</Modal>

<Modal
	bind:open={confirmingDelete}
	title={m.staff_marketing_campaigns_id_edit_delete_draft_title()}
>
	<p>
		<ParaglideMessage
			message={m.staff_marketing_campaigns_id_edit_delete_goes_text}
			inputs={{
				subject: subject.trim() || m.staff_marketing_campaigns_id_edit_untitled_campaign_2_text()
			}}>{#snippet em({ children })}<em>{@render children?.()}</em>{/snippet}</ParaglideMessage
		>
	</p>
	<div class="modal-action">
		<Button variant="default" size="sm" outline onclick={() => (confirmingDelete = false)}>
			{m.staff_marketing_campaigns_id_edit_keep_label()}
		</Button>
		<Button variant="error" size="sm" onclick={deleteNow}
			>{m.staff_marketing_campaigns_id_edit_delete_draft_2_label()}</Button
		>
	</div>
</Modal>
