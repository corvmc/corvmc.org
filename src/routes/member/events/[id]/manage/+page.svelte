<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import AppealPanel from '#lib/components/moderation/AppealPanel.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import LineupEditor, { type LineupChip } from '#lib/components/events/LineupEditor.svelte';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		getMyListingPage,
		searchBandsForListing,
		updateListing,
		publishListing,
		unpublishListing,
		withdrawListing,
		deleteListing
	} from '#lib/remote/community-events.remote.js';
	import { formatDateShort, formatDollars } from '#lib/utils/format.js';
	import { imageSrc } from '#lib/utils/images.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	// Declared before the awaited query: a declaration after one is async-gated,
	// which would compile every `fields.X.as()` into an async derived.
	const fields = updateListing.fields;
	const publishFields = publishListing.fields;
	const unpublishFields = unpublishListing.fields;
	const withdrawFields = withdrawListing.fields;
	const deleteFields = deleteListing.fields;

	const eventId = $derived(params.id);
	// One query. The duplicate check is advisory copy next to Publish and only means anything for
	// a draft, so that condition moved server-side with it.
	const pageData = $derived(await getMyListingPage(eventId));
	const listing = $derived(pageData.listing);
	const duplicate = $derived(pageData.duplicate);

	const requiresReview = $derived(listing?.standing.status !== 'none');

	// A button that silently does something other than what it says is worse
	// than the delay itself.
	const publishLabel = $derived(
		requiresReview ? m.member_events_id_manage_submit_review_label() : m.member_publish_label()
	);

	let lineup = $state<LineupChip[]>([]);
	let lineupLoaded = $state(false);
	$effect(() => {
		if (!lineupLoaded && listing) {
			lineup = listing.lineup.map((l) => ({
				name: l.name,
				bandId: l.bandId ?? undefined,
				status: l.status
			}));
			lineupLoaded = true;
		}
	});

	function toTimeValue(d: Date | null): string {
		if (!d) return '';
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}
	function toDateValue(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	function toDollars(cents: number | null): string {
		return cents == null ? '' : formatDollars(cents);
	}
</script>

{#if !listing}
	<PageHeader width="2xl" title={m.member_events_id_manage_title()} />
	<PageContent width="2xl">
		<Alert type="warning">
			<ParaglideMessage
				message={m.member_events_id_manage_listing_doesn_t_exist_isn_body}
				inputs={{}}
				>{#snippet a({ children })}<a href={resolve('member/events')} class="link"
						>{@render children?.()}</a
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	</PageContent>
{:else}
	<PageHeader title={listing.title}>
		<StatusBadge status={listing.status} label />
	</PageHeader>

	<PageContent width="2xl">
		{#if listing.status === 'rejected'}
			<!-- The reason is the entire point of a rejection: a member who can't see
			     what was wrong can't fix it, and `rejected` exists so they can. -->
			<Alert type="warning">
				<strong>{m.member_events_id_manage_staff_didn_t_publish_listing_body()}</strong>
				{#if listing.reviewNotes}
					<p class="mt-1">"{listing.reviewNotes}"</p>
				{/if}
				<p class="mt-1">{m.member_events_id_manage_fix_below_submit_again_everything_text()}</p>
			</Alert>
		{:else if listing.status === 'pending_review'}
			<Alert type="info">
				{m.member_events_id_manage_listing_with_staff_review_ll_body()}
			</Alert>
		{:else if listing.status === 'draft' && listing.reviewNotes}
			<!-- Staff pulled this off the guide. Ordered ahead of the standing
			     explainer below: a takedown is specific news about THIS listing,
			     and the standing note is background the member has already seen. -->
			<Alert type="warning">
				<strong>{m.member_events_id_manage_staff_took_listing_off_calendar_body()}</strong>
				<p class="mt-1">"{listing.reviewNotes}"</p>
				<p class="mt-1">{m.member_events_id_manage_fix_publish_again_when_re_text()}</p>
				<AppealPanel target={{ kind: 'listing', eventId: listing.id }} />
			</Alert>
		{:else if requiresReview && listing.status === 'draft'}
			<Alert type="info">
				{#if listing.standing.reason}
					{m.member_events_id_manage_after_report_was_upheld_against_body({
						reason: listing.standing.reason
					})}
				{:else}
					{m.member_events_id_manage_staff_check_listings_before_they_body()}
				{/if}
				<AppealPanel target={{ kind: 'standing', scope: 'community_event' }} />
			</Alert>
		{:else if listing.status === 'cancelled'}
			<Alert type="info">
				{m.member_events_id_manage_ve_marked_show_as_cancelled_body()}
			</Alert>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			{#if listing.status === 'draft' || listing.status === 'rejected'}
				<Action
					action={publishListing}
					label={publishLabel}
					data-testid="publish-listing"
					successToast={requiresReview ? m.member_sent_staff_toast() : m.member_published_toast()}
					variant="primary"
					size="sm"
					onsuccess={() => refreshAll()}
				>
					{#snippet form()}
						<input {...publishFields.eventId.as('hidden', eventId)} />
						{#if requiresReview}
							<p class="py-2">
								{m.member_events_id_manage_staff_will_look_at_before_text()}
							</p>
						{:else}
							<p class="py-2">{m.member_events_id_manage_put_show_public_calendar_text()}</p>
						{/if}
					{/snippet}
				</Action>

				<Action
					action={deleteListing}
					label={m.member_events_id_manage_delete_label()}
					successToast={m.member_events_id_manage_listing_deleted_toast()}
					variant="ghost"
					size="sm"
					onsuccess={() => goto(resolve('member/events'))}
				>
					{#snippet form()}
						<input {...deleteFields.eventId.as('hidden', eventId)} />
						<p class="py-2">
							{m.member_events_id_manage_delete_listing_was_never_public_text()}
						</p>
					{/snippet}
				</Action>
			{:else if listing.status === 'published'}
				<Action
					action={unpublishListing}
					label={m.member_events_id_manage_take_down_label()}
					successToast={m.member_events_id_manage_back_drafts_toast()}
					variant="ghost"
					size="sm"
					onsuccess={() => refreshAll()}
				>
					{#snippet form()}
						<input {...unpublishFields.eventId.as('hidden', eventId)} />
						<p class="py-2">
							{m.member_events_id_manage_move_back_drafts_comes_off_text()}
						</p>
					{/snippet}
				</Action>

				<Action
					action={withdrawListing}
					label={m.member_events_id_manage_cancel_show_label()}
					successToast={m.member_events_id_manage_marked_as_cancelled_toast()}
					variant="warning"
					size="sm"
					onsuccess={() => refreshAll()}
				>
					{#snippet form()}
						<input {...withdrawFields.eventId.as('hidden', eventId)} />
						<p class="py-2">
							<ParaglideMessage
								message={m.member_events_id_manage_show_not_happening_stays_calendar_text}
								inputs={{}}
								>{#snippet strong({ children })}<strong>{@render children?.()}</strong
									>{/snippet}</ParaglideMessage
							>
						</p>
					{/snippet}
				</Action>
			{/if}
		</div>

		{#if duplicate}
			<Alert type="warning">
				<strong>{m.member_events_id_manage_might_already_listed_body()}</strong>
				<p class="mt-1">
					<ParaglideMessage
						message={m.member_events_id_manage_already_calendar_publish_anyway_if_text}
						inputs={{
							title: duplicate.title,
							formatDateShort: formatDateShort(duplicate.startsAt)
						}}
						>{#snippet a({ children })}<a href={resolve(`events/${duplicate.id}`)} class="link"
								>{@render children?.()}</a
							>{/snippet}</ParaglideMessage
					>
				</p>
			</Alert>
		{/if}

		<Form
			remote={updateListing}
			successToast={m.member_events_id_manage_listing_saved_toast()}
			onsuccess={() => refreshAll()}
			class="space-y-4"
		>
			<input {...fields.eventId.as('hidden', eventId)} />

			<FormField
				field={fields.title}
				type="text"
				label={m.member_title_label()}
				value={listing.title}
				maxlength="200"
				required
			/>

			<!-- The `input` snippet, not children: only it is handed the id the
			     caption points at, so children would leave the field unnamed. -->
			<FormField
				field={updateListing.fields.description}
				label={m.member_events_id_manage_description_label()}
			>
				{#snippet input(id)}
					<textarea
						{...fields.description.as('text', listing.description ?? '')}
						{id}
						class="textarea w-full"
						rows="4"
						maxlength="5000"></textarea>
				{/snippet}
			</FormField>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<FormField
					field={fields.eventDate}
					type="date"
					label={m.member_date_label()}
					value={toDateValue(listing.startsAt)}
					required
				/>
				<FormField
					field={fields.eventStartTime}
					type="time"
					label={m.member_start_time_label()}
					value={toTimeValue(listing.startsAt)}
					required
				/>
				<FormField
					field={fields.eventEndTime}
					type="time"
					label={m.member_events_id_manage_end_time_label()}
					value={toTimeValue(listing.endsAt)}
					description={m.member_events_id_manage_optional_leave_blank_if_don_body()}
				/>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField
					field={fields.doorsTime}
					type="time"
					label={m.member_events_id_manage_doors_open_label()}
					value={toTimeValue(listing.doorsAt)}
				/>
				<FormField
					field={fields.location}
					type="text"
					label={m.member_venue_label()}
					value={listing.location ?? ''}
					maxlength="500"
					required
				/>
			</div>

			<FormField
				field={fields.address}
				type="text"
				label={m.member_address_label()}
				value={listing.address ?? ''}
				maxlength="500"
			/>

			<FormField
				field={fields.tags}
				type="text"
				label={m.member_tags_label()}
				value={listing.tags ?? ''}
				maxlength="500"
			/>

			<FormField
				field={updateListing.fields.lineup}
				label={m.member_events_id_manage_who_s_playing_label()}
				description={m.member_events_id_manage_naming_band_s_site_asks_body()}
			>
				<LineupEditor
					field={updateListing.fields.lineup}
					bind:value={lineup}
					search={searchBandsForListing}
				/>
			</FormField>

			<FormField
				field={fields.posterFile}
				type="file"
				label={m.member_events_id_manage_poster_label()}
				description={m.member_events_id_manage_jpeg_png_webp_up_10_body()}
				accept="image/jpeg,image/png,image/webp"
				src={listing.posterUrl ? imageSrc(listing.posterUrl, 'thumb').src : undefined}
				previewClass="h-32 w-24"
				emptyLabel={m.member_events_id_manage_empty_label_title()}
				replaceLabel={m.member_events_id_manage_replace_label()}
			/>

			<div class="grid gap-4 md:grid-cols-2">
				<FormField
					field={fields.externalTicketUrl}
					type="text"
					label={m.member_events_id_manage_ticket_link_label()}
					value={listing.externalTicketUrl ?? ''}
				/>
				<FormField
					field={fields.ticketPriceDollars}
					type="text"
					label={m.member_events_id_manage_ticket_price_label()}
					value={toDollars(listing.ticketPrice)}
					inputmode="decimal"
					description={m.member_events_id_manage_what_people_pay_at_door_body()}
				/>
			</div>

			<div class="flex justify-end pt-4">
				<SubmitButton label={m.member_events_id_manage_save_changes_label()} variant="primary" />
			</div>
		</Form>
	</PageContent>
{/if}
