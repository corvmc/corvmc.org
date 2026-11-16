<!--
	What the bill still owes us, and the ask that starts the wait.

	Arrival is derived from the artifact itself, so nothing here is ticked off by
	hand and a rider filled in unprompted already reads as in. Asking the same act
	for the same thing again is a reminder, not a second row.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { requestableArtifacts, requestableArtifactLabels } from '#lib/config.js';
	import {
		askForArtifact,
		dropArtifactRequest,
		usePosterArt,
		usePosterArtWithFooter
	} from '#lib/remote/productions.remote.js';
	import { searchAskableListings } from '#lib/remote/external-acts.remote.js';
	import type { OutstandingRequest } from '#lib/types/artifact-request.js';
	import { requestsState } from './section-state';

	// The picker writes a plain hidden input; the Action's form is not a `<Form>`.
	const artistField = {
		as: (_type: 'hidden', value: string) => ({ type: 'hidden', name: 'entryId', value })
	};

	let {
		eventId,
		eventTitle,
		requests,
		acts,
		onchange
	}: {
		eventId: string;
		eventTitle: string;
		requests: OutstandingRequest[];
		acts: { entryId: string; name: string }[];
		onchange: () => void;
	} = $props();
</script>

<InfoCard
	title={m.staff_events_id_production_artifact_requests_panel_asked_title()}
	state={requestsState(requests)}
>
	{#snippet action()}
		<div class="flex items-center gap-1">
			{#if acts.length > 0}
				<Action
					action={askForArtifact}
					label={m.staff_events_id_production_artifact_requests_panel_ask_band_label()}
					variant="ghost"
					size="sm"
					modalTitle={m.staff_events_id_production_artifact_requests_panel_ask_band_2_title({
						eventTitle
					})}
					submitLabel={m.staff_events_id_production_artifact_requests_panel_ask_label()}
					successToast={m.staff_events_id_production_artifact_requests_panel_asked_2_toast()}
					onsuccess={onchange}
				>
					{#snippet form()}
						<input {...askForArtifact.fields.eventId.as('hidden', eventId)} />
						<FormField
							field={askForArtifact.fields.entryId}
							label={m.staff_band_label()}
							type="select"
							options={acts.map((a) => ({ value: a.entryId, label: a.name }))}
						/>
						<FormField
							field={askForArtifact.fields.artifact}
							label={m.staff_what_label()}
							type="select"
							options={requestableArtifacts.map((a) => ({
								value: a,
								label: requestableArtifactLabels[a]
							}))}
						/>
						<FormField
							field={askForArtifact.fields.dueDate}
							label={m.staff_due_label()}
							type="date"
							description={m.staff_events_id_production_artifact_requests_panel_optional_body()}
						/>
					{/snippet}
				</Action>
			{/if}
			<!-- An artist is never on the bill, so this searches every listing. -->
			<Action
				action={askForArtifact}
				label={m.staff_events_id_production_artifact_requests_panel_commissio_label()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_events_id_production_artifact_requests_panel_commissio_2_title({
					eventTitle
				})}
				submitLabel={m.staff_events_id_production_artifact_requests_panel_ask_label()}
				successToast={m.staff_events_id_production_artifact_requests_panel_asked_2_toast()}
				onsuccess={onchange}
			>
				{#snippet form()}
					<input {...askForArtifact.fields.eventId.as('hidden', eventId)} />
					<input {...askForArtifact.fields.artifact.as('hidden', 'poster_art')} />
					<MemberPicker
						field={artistField}
						label={m.staff_events_id_production_artifact_requests_panel_artist_label()}
						placeholder={m.staff_events_id_production_artifact_requests_panel_placehold_placeholder()}
						search={(q) => searchAskableListings(q)}
					/>
					<FormField
						field={askForArtifact.fields.dueDate}
						label={m.staff_due_label()}
						type="date"
						description={m.staff_events_id_production_artifact_requests_panel_when_art_body()}
					/>
					<p class="text-subtle text-sm">
						{m.staff_events_id_production_artifact_requests_panel_artist_up_text()}
					</p>
				{/snippet}
			</Action>
		</div>
	{/snippet}

	{#if requests.length === 0}
		<EmptyState
			title={m.staff_events_id_production_artifact_requests_panel_nothing_a_title()}
			description={m.staff_events_id_production_artifact_requests_panel_nobody_ha_body()}
		/>
	{:else}
		<ul class="divide-y divide-base-300">
			{#each requests as req (req.id)}
				<li class="flex flex-wrap items-center gap-2 py-2">
					<span class="font-medium"
						>{req.actName ??
							m.staff_events_id_production_artifact_requests_panel_unknown_b_text()}</span
					>
					<span class="text-sm">{requestableArtifactLabels[req.artifact]}</span>
					{#if req.fulfilled}
						<Badge variant="success"
							>{m.staff_events_id_production_artifact_requests_panel_text_label()}</Badge
						>
					{:else if req.overdue}
						<Badge variant="error">{m.staff_overdue_label()}</Badge>
					{:else}
						<Badge variant="warning"
							>{m.staff_events_id_production_artifact_requests_panel_waiting_label()}</Badge
						>
					{/if}
					<span class="text-subtle text-sm whitespace-nowrap">
						{#if req.dueAt}
							{m.staff_due_2_text({ formatDateShort: formatDateShort(req.dueAt) })}
						{:else}
							{m.staff_no_deadline_text()}
						{/if}
					</span>
					<div class="ml-auto flex items-center gap-1">
						{#if req.deliveredUrl}
							<a href={req.deliveredUrl} target="_blank" rel="external noreferrer">
								<img
									src={req.deliveredUrl}
									alt={m.staff_events_id_production_artifact_requests_panel_alt_text({
										value: req.actName ?? 'the artist'
									})}
									class="h-12 w-auto rounded"
								/>
							</a>
							<Action
								action={usePosterArt}
								label={m.staff_events_id_production_artifact_requests_panel_use_as_po_label()}
								variant="ghost"
								size="sm"
								modalTitle={m.staff_events_id_production_artifact_requests_panel_make_post_title()}
								submitLabel={m.staff_events_id_production_artifact_requests_panel_use_as_po_label()}
								successToast={m.staff_events_id_production_artifact_requests_panel_poster_up_toast()}
								onsuccess={onchange}
							>
								{#snippet form()}
									<input {...usePosterArt.fields.requestId.as('hidden', req.id)} />
									<input {...usePosterArt.fields.eventId.as('hidden', eventId)} />
									<p class="text-sm">
										{m.staff_events_id_production_artifact_requests_panel_art_from_text({
											actName:
												req.actName ??
												m.staff_events_id_production_artifact_requests_panel_artist_2_text()
										})}
									</p>
								{/snippet}
							</Action>
							<Action
								action={usePosterArtWithFooter}
								label={m.staff_events_id_production_artifact_requests_panel_use_with_label()}
								variant="ghost"
								size="sm"
								modalTitle={m.staff_events_id_production_artifact_requests_panel_add_show_title()}
								submitLabel={m.staff_events_id_production_artifact_requests_panel_make_post_2_label()}
								successToast={m.staff_events_id_production_artifact_requests_panel_poster_up_toast()}
								onsuccess={onchange}
							>
								{#snippet form()}
									<input {...usePosterArtWithFooter.fields.requestId.as('hidden', req.id)} />
									<input {...usePosterArtWithFooter.fields.eventId.as('hidden', eventId)} />
									<p class="text-sm">
										{m.staff_events_id_production_artifact_requests_panel_art_sits_text()}
									</p>
								{/snippet}
							</Action>
						{/if}
						<Action
							action={dropArtifactRequest}
							label={m.staff_cancel_label()}
							variant="ghost"
							size="sm"
							modalTitle={m.staff_events_id_production_artifact_requests_panel_stop_wait_title()}
							submitLabel={m.staff_cancel_request_label()}
							successToast={m.staff_request_cancelled_toast()}
							onsuccess={onchange}
						>
							{#snippet form()}
								<input {...dropArtifactRequest.fields.id.as('hidden', req.id)} />
								<input {...dropArtifactRequest.fields.eventId.as('hidden', eventId)} />
								<p class="text-sm">
									{m.staff_events_id_production_artifact_requests_panel_from_stop_text({
										value: requestableArtifactLabels[req.artifact],
										actName:
											req.actName ??
											m.staff_events_id_production_artifact_requests_panel_band_text()
									})}
								</p>
							{/snippet}
						</Action>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
