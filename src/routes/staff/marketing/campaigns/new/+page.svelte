<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import AudiencePicker from '../AudiencePicker.svelte';
	import EventScopePicker, { type EventOption } from '../EventScopePicker.svelte';
	import CampaignPreview from '../CampaignPreview.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { errorMessage } from '#lib/error-message.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import FormGuard from '#lib/components/ui/Form/FormGuard.svelte';
	import {
		createDraft,
		createAndSend,
		createAndSchedule,
		sendTestCampaign
	} from '#lib/remote/marketing.remote.js';
	import { getEventForCampaign } from '#lib/remote/events.remote.js';

	// `?event=<id>` is a campaign started from the show's page (#2776): the show
	// chosen and "Event audience" ticked. Read once; the picker owns it after.
	const eventParam = page.url.searchParams.get('event');
	const preset = eventParam ? await getEventForCampaign(eventParam) : null;

	let subject = $state('');
	let markdownBody = $state('');
	let selectedAudienceIds = $state<string[]>([]);
	let event = $state<EventOption | null>(preset);
	let scheduledFor = $state('');
	let submitting = $state(false);

	// Written back by AudiencePicker, which owns the audience query.
	let totalSubscribers = $state(0);

	let confirmingSend = $state(false);

	// Set once the campaign exists: what was typed is saved.
	let leaving = false;
	const isDirty = () =>
		!leaving &&
		!!(
			subject.trim() ||
			markdownBody.trim() ||
			// With a show preset, the picker ticks its audience: that alone is no edit.
			(!preset && selectedAudienceIds.length) ||
			(event?.id ?? null) !== (preset?.id ?? null) ||
			scheduledFor
		);

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
		leaving = true;
		if (result?.campaignId) goto(to(result.campaignId));
	}

	function handleSaveDraft() {
		if (!isValid()) return;
		return submit(
			() =>
				createDraft({
					subject: subject.trim(),
					markdownBody,
					audienceIds: selectedAudienceIds,
					eventId: event?.id ?? ''
				}),
			'Draft saved',
			(id) => resolve(`staff/marketing/campaigns/${id}/edit`)
		);
	}

	/**
	 * A test reads the stored campaign, so it saves the draft first and opens it:
	 * the staffer keeps editing there, and a second test does not make a second draft.
	 */
	async function handleSendTest() {
		if (!isValid()) return;
		submitting = true;
		let campaignId: string;
		try {
			({ campaignId } = await createDraft({
				subject: subject.trim(),
				markdownBody,
				audienceIds: selectedAudienceIds,
				eventId: event?.id ?? ''
			}));
		} catch (err) {
			toast.error(errorMessage(err));
			submitting = false;
			return;
		}
		leaving = true;
		try {
			const result = await sendTestCampaign({ campaignId });
			if (result?.sent)
				toast.success(m.staff_marketing_campaigns_test_sent_toast({ email: result.to }));
			else
				toast.error(
					m.staff_marketing_campaigns_test_not_sent_toast({ error: result?.error ?? '' })
				);
		} catch (err) {
			toast.error(errorMessage(err));
		}
		goto(resolve(`staff/marketing/campaigns/${campaignId}/edit`));
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
				createAndSend({
					subject: subject.trim(),
					markdownBody,
					audienceIds: selectedAudienceIds,
					eventId: event?.id ?? ''
				}),
			'Campaign sent',
			(id) => resolve(`staff/marketing/campaigns/${id}`)
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
					eventId: event?.id ?? '',
					scheduledFor: new Date(scheduledFor).toISOString()
				}),
			'Campaign scheduled',
			(id) => resolve(`staff/marketing/campaigns/${id}`)
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

<FormGuard dirty={isDirty} />

<PageHeader title={m.staff_new_campaign_title()} subtitle={m.staff_marketing_body()} />
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
				<AudiencePicker
					bind:selected={selectedAudienceIds}
					bind:total={totalSubscribers}
					{event}
					tickEventAudience={!!preset}
				/>
			</div>

			<div>
				<p class="label text-sm font-medium">{m.staff_about_show_text()}</p>
				<EventScopePicker initial={preset} onchange={(e) => (event = e)} />
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

			<!-- Actions -->
			<div class="flex flex-wrap gap-2">
				<Button
					variant="default"
					size="sm"
					outline
					disabled={!isValid() || submitting}
					onclick={handleSaveDraft}
				>
					{m.staff_save_draft_label()}
				</Button>
				<Button
					variant="default"
					size="sm"
					outline
					disabled={!isValid() || submitting}
					onclick={handleSendTest}
				>
					{m.staff_marketing_campaigns_send_test_label()}
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
				trim: subject.trim() || m.staff_marketing_campaigns_new_untitled_campaign_text()
			}}
			>{#snippet strong({ children })}<strong>{@render children?.()}</strong
				>{/snippet}{#snippet em({ children })}<em>{@render children?.()}</em
				>{/snippet}</ParaglideMessage
		>
	</p>
	<p class="mt-2 text-muted">
		{m.staff_marketing_campaigns_new_there_no_recall_if_not_text()}
	</p>
	<div class="modal-action">
		<Button variant="default" size="sm" outline onclick={() => (confirmingSend = false)}>
			{m.staff_not_yet_label()}
		</Button>
		<Button variant="primary" size="sm" onclick={sendNow}>
			{m.staff_send_people_label({ totalSubscribers })}
		</Button>
	</div>
</Modal>
