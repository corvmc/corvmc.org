<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { EntityChip, EntityIdentity } from '#lib/components/ui/entity/index.js';
	import LineupEditor, { type LineupChip } from '#lib/components/events/LineupEditor.svelte';
	import ListingEditForm from '#lib/components/events/ListingEditForm.svelte';
	import ListingPosterCard from '#lib/components/events/ListingPosterCard.svelte';
	import ListingQrCard from '#lib/components/events/ListingQrCard.svelte';
	import RecurringSeriesBar from '#lib/components/events/RecurringSeriesBar.svelte';
	import RepeatEventAction from '#lib/components/events/RepeatEventAction.svelte';
	import SpaceHoldCard from '#lib/components/events/SpaceHoldCard.svelte';
	import ListingTicketing from '#lib/components/events/ListingTicketing.svelte';
	import DoorSalesCard from '#lib/components/events/DoorSalesCard.svelte';
	import {
		PublishEventAction,
		UnpublishEventAction,
		CancelEventAction,
		DeleteEventAction
	} from '#lib/components/actions/index.js';
	import {
		getEventHistory,
		getStaffEventPage,
		setStaffEventLineup
	} from '#lib/remote/events.remote.js';
	import { ActivityFeedCard, feedItemRow } from '#lib/components/ui/ActivityFeed/index.js';
	import {
		approveListing,
		rejectListing,
		searchBandsForListing
	} from '#lib/remote/community-events.remote.js';
	import { rowLink } from '#lib/actions/row-link.js';
	import RecapPhotos from './RecapPhotos.svelte';
	import RecapText from './RecapText.svelte';
	import EventRsvps from './EventRsvps.svelte';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { formatTime, fullDate } from '#lib/utils/format.js';

	/**
	 * The listing — every source, any staffer — and where `entity-href` sends
	 * every event ref. It owns everything public-facing: the lifecycle, the full
	 * edit, the poster, the series, the room hold and the sale (#1946). The console at
	 * `[id]/production` is back-of-house only. Writes take `event.manage` or the
	 * show's committee; the guard is `requireListingWriter`, on the remotes.
	 */
	const id = $derived(page.params.id!);
	const data = $derived(await getStaffEventPage(id));
	const evt = $derived(data.detail.event);
	const detail = $derived(data.detail);

	const isProduction = $derived(evt.source === 'cmc');
	const isBandEvent = $derived(evt.source === 'band');
	const isCommunityEvent = $derived(evt.source === 'community');

	const rejectFields = rejectListing.fields;

	function refresh() {
		void getStaffEventPage(id).refresh();
	}

	// ── Edit ──────────────────────────────────────────────────────────────
	// The whole listing: every `updateEvent` field, ticketing and the room hold
	// included. The sale's stats, comps and tickets are `ListingTicketing`.
	let editing = $state(false);
	let lineup = $state<LineupChip[]>([]);

	function startEditing() {
		lineup = detail.lineup.map((l) => ({ name: l.name, bandId: l.bandId ?? undefined }));
		editing = true;
	}

	// `?edit=1` is where the create modal lands: it collects only what the row
	// needs, so the rest is filled in here. Consumed once, so Save closes it.
	let editFromUrl = false;
	$effect(() => {
		if (editFromUrl || !page.url.searchParams.has('edit')) return;
		editFromUrl = true;
		startEditing();
	});

	// Held, or a CMC show that ought to say whether it is. A band gig or a
	// community listing with no hold has no question for this card to answer.
	const showsHold = $derived(isProduction || !!detail.linkedReservation);

	// Our own listings and a club's sessions repeat; a band's gig or a community
	// listing is someone else's to schedule.
	const canRepeat = $derived(
		(evt.source === 'cmc' || evt.source === 'group') && evt.status !== 'cancelled'
	);

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}
</script>

<PageHeader width="3xl" title={evt.title} subtitle={m.staff_event()}>
	<div class="flex flex-wrap items-center gap-2">
		{#if isProduction}
			<!-- One entry, not two. "Manage production" and "Add production" sat
			     side by side before a production existed, and a first-timer picked
			     the first — landing on a console that told them to go back where
			     they came from. Opening one now lives in that console's empty
			     state, which is the page that explains what a production is
			     (#976). -->
			<Button href={resolve(`/staff/events/${id}/production`)} variant="default" size="sm" outline>
				{data.production
					? m.staff_events_id_manage_production()
					: m.staff_events_id_open_production()}
			</Button>
		{/if}

		{#if evt.ticketingEnabled}
			<Button href="/staff/events/{evt.id}/check-in" variant="ghost" size="sm"
				>{m.staff_events_id_check()}</Button
			>
		{/if}

		{#if evt.kind === 'market'}
			<Button href={resolve(`/staff/events/${id}/vendors`)} variant="ghost" size="sm"
				>{m.staff_vendors()}</Button
			>
		{/if}

		{#if (evt.status !== 'cancelled' || data.canEditCancelled) && !editing}
			<Button variant="ghost" size="sm" data-testid="edit-listing" onclick={startEditing}>
				{m.staff_edit()}
			</Button>
		{/if}

		{#if evt.status === 'draft'}
			<PublishEventAction eventId={evt.id} />
		{/if}

		{#if evt.status === 'pending_review'}
			<!-- Approve, not Publish: approving also clears the last turn-down note
			     and tells the member. Turning it down needs a reason, because
			     `rejected` exists so the member can fix and resubmit. -->
			<Action
				action={approveListing}
				label={m.staff_approve()}
				successToast={m.staff_events_id_approved_published()}
				variant="success"
				size="sm"
				onsuccess={() => invalidateAll()}
			>
				{#snippet form()}
					<input {...approveListing.fields.eventId.as('hidden', evt.id)} />
					<p class="py-2">{m.staff_events_id_publish_listing_let_member_know()}</p>
				{/snippet}
			</Action>
			<Action
				action={rejectListing}
				label={m.staff_events_id_turn_down()}
				data-testid="reject-listing"
				successToast={m.staff_events_id_sent_back_member()}
				variant="warning"
				size="sm"
				onsuccess={() => invalidateAll()}
			>
				{#snippet form()}
					<input {...rejectFields.eventId.as('hidden', evt.id)} />
					<FormField
						field={rejectFields.notes}
						type="textarea"
						label={m.staff_events_id_what_needs_change()}
						description={m.staff_events_id_description()}
					/>
				{/snippet}
			</Action>
		{/if}

		{#if evt.status === 'published'}
			<UnpublishEventAction eventId={evt.id} />
		{/if}

		{#if evt.status !== 'cancelled'}
			<CancelEventAction eventId={evt.id} />
		{/if}

		<DeleteEventAction eventId={evt.id} />
	</div>
</PageHeader>

<PageContent width="3xl">
	<div class="flex flex-wrap items-center gap-2">
		<StatusBadge status={evt.status} label />
		{#if evt.publishedAt}
			<span class="text-muted"
				>{m.staff_events_id_published({ fullDate: fullDate(evt.publishedAt) })}</span
			>
		{/if}
	</div>

	<!-- What was already said, before saying it again. -->
	{#if evt.status === 'rejected' && evt.reviewNotes}
		<Alert type="warning">
			{m.staff_events_id_turned_down_staff_note({ reviewNotes: evt.reviewNotes })}
		</Alert>
	{/if}

	<!--
		Who is accountable, which is a different record per source: a band manages
		its own gig, a member owns their listing, and the collective's own shows
		answer with neither. This also absorbs what used to be a second "Created
		by" card saying the same name and email over again.
	-->
	<InfoCard title={m.staff_posted_by()}>
		{#if isProduction}
			<p class="text-sm font-medium">{m.staff_cmc()}</p>
		{:else if isBandEvent}
			<p class="flex flex-wrap items-center gap-2 text-sm">
				{#if detail.bandRef}
					<EntityChip ref={detail.bandRef} />
				{:else}
					<span class="font-medium">{m.staff_events_id_band()}</span>
				{/if}
			</p>
		{:else}
			<p class="flex flex-wrap items-center gap-2 text-sm">
				{#if detail.submitter}
					<EntityChip ref={detail.submitter} />
				{:else}
					<span class="font-medium">{m.staff_events_id_unknown_member()}</span>
				{/if}
				{#if detail.creator?.email}
					<span class="text-muted">{detail.creator.email}</span>
				{/if}
			</p>
		{/if}

		<p class="mt-1 text-muted">
			{m.staff_events_id_submitted({ fullDate: fullDate(evt.createdAt) })}
		</p>

		<!-- Community only: standing is a member-level fact, and whether a band
		     can be flagged the same way is a different axis. -->
		{#if isCommunityEvent && detail.submitterStanding && detail.submitterStanding.status !== 'none'}
			<Alert type="warning" class="mt-2">
				{m.staff_events_id_member_s_listings_checked_before()}
				{#if detail.submitterStanding.reason}
					{m.staff_staff_note({ reason: detail.submitterStanding.reason })}
				{/if}
			</Alert>
		{/if}
	</InfoCard>

	<!--
		The record a producer just made, on the page they made it from. Creating
		one changed nothing visible here except that a button disappeared from the
		header, so the only way to know it had worked was to read the database
		(#976). Rendered only when one exists: a listing that is not a CMC
		production never becomes one, and an empty card on every band gig would be
		noise.
	-->
	{#if data.production}
		<InfoCard title={m.staff_production()}>
			<div class="flex flex-wrap items-center gap-2">
				<StatusBadge status={data.production.status} label />
				{#if data.production.producerName}
					<span class="text-muted"
						>{m.staff_events_id_produced_by({ producerName: data.production.producerName })}</span
					>
				{:else}
					<span class="text-muted">{m.staff_events_id_no_producer_yet()}</span>
				{/if}
			</div>

			{#if data.production.loadInAt}
				<p class="mt-2 text-sm">
					{m.staff_events_id_load({ fullDate: fullDate(data.production.loadInAt) })}
				</p>
			{:else}
				<p class="mt-2 text-muted">{m.staff_events_id_load_soundcheck_curfew_not_set()}</p>
			{/if}

			<Button
				href={resolve(`/staff/events/${id}/production`)}
				variant="default"
				size="sm"
				outline
				class="mt-3"
			>
				{m.staff_events_id_open_console()}
			</Button>
		</InfoCard>
	{/if}

	{#if data.recurringSeries}
		<RecurringSeriesBar eventId={evt.id} series={data.recurringSeries} onchange={refresh} />
	{:else if canRepeat}
		<div>
			<RepeatEventAction eventId={evt.id} startsAt={evt.startsAt} onsuccess={refresh} />
		</div>
	{/if}

	{#if editing}
		<ListingEditForm
			event={evt}
			linkedReservation={detail.linkedReservation}
			venues={data.venues}
			cancelled={evt.status === 'cancelled'}
			onsaved={() => {
				editing = false;
				refresh();
			}}
			oncancel={() => (editing = false)}
		/>

		<InfoCard title={m.staff_events_id_bill()}>
			<!--
				The bill saves separately. `setStaffEventLineup` decides consent from
				the event's source, and folding it into `updateEvent` would put that
				rule behind a form the console also posts.
			-->
			<div>
				<Form
					remote={setStaffEventLineup}
					successToast={m.staff_events_id_bill_updated()}
					onsuccess={() => {
						editing = false;
						refresh();
					}}
				>
					<input {...setStaffEventLineup.fields.eventId.as('hidden', evt.id)} />
					<input {...setStaffEventLineup.fields.lineup.as('hidden', JSON.stringify(lineup))} />
					<LineupEditor bind:value={lineup} search={searchBandsForListing} />
					<div class="mt-3"><SubmitButton label={m.staff_events_id_save_bill()} /></div>
				</Form>
			</div>
		</InfoCard>
	{/if}

	<InfoCard title={m.staff_event()}>
		<p class="text-xl font-medium">{fullDate(evt.startsAt)}</p>
		<p class="text-muted">
			{#if evt.doorsAt}
				{m.staff_events_id_doors_show({
					formatTime: formatTime(evt.doorsAt),
					formatEventTimeRange: formatEventTimeRange(evt.startsAt, evt.endsAt)
				})}
			{:else}
				{formatEventTimeRange(evt.startsAt, evt.endsAt)}
			{/if}
		</p>

		{#if evt.location}
			<p class="text-muted">{evt.location}</p>
		{/if}

		{#if evt.externalTicketUrl}
			<a
				href={evt.externalTicketUrl}
				class="link text-sm"
				target="_blank"
				rel="noopener noreferrer external"
			>
				{m.staff_events_id_tickets()}
			</a>
		{/if}

		{#if detail.lineup.length > 0}
			<div class="mt-4 border-t border-base-200 pt-4">
				<p class="mb-2 text-muted font-medium">{m.staff_events_id_bill_2()}</p>
				<ul class="space-y-1">
					{#each detail.lineup as act (act.id)}
						<li class="flex flex-wrap items-center gap-2 text-sm">
							<span class="font-medium">{act.name}</span>
							<!-- `unlinked` is a plain credit; anything else is a claim on a
							     band's profile, so the status is worth showing. -->
							{#if act.status !== 'unlinked'}
								<StatusBadge status={act.status} />
							{/if}
							{#if act.note}<span class="text-muted">{act.note}</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if evt.description}
			<div class="mt-4 border-t border-base-200 pt-4">
				<p class="whitespace-pre-wrap">{evt.description}</p>
			</div>
		{/if}

		{#if parseTags(evt.tags).length > 0}
			<div class="mt-4 flex flex-wrap gap-1 pt-4 rule-top">
				{#each parseTags(evt.tags) as tag (tag)}
					<Badge variant="outline">{tag}</Badge>
				{/each}
			</div>
		{/if}
	</InfoCard>

	<ListingPosterCard
		eventId={evt.id}
		posterUrl={detail.posterUrl}
		cancelled={evt.status === 'cancelled'}
		uploadWhileCancelled={data.canEditCancelled}
		onchange={refresh}
	/>

	{#if evt.status !== 'cancelled'}
		<ListingQrCard eventId={evt.id} title={evt.title} published={evt.status === 'published'} />
	{/if}

	<ListingTicketing
		event={evt}
		ticketStats={detail.ticketStats}
		ticketMoney={detail.ticketMoney}
		tickets={detail.tickets}
		onchange={refresh}
	/>

	{#if detail.door}
		<DoorSalesCard eventId={evt.id} takings={detail.door.takings} open={detail.door.open} />
	{/if}

	{#if showsHold}
		<SpaceHoldCard
			venueName={evt.venueName}
			venueIsPrimary={evt.venueIsPrimary}
			reservation={detail.linkedReservation}
			editableEventId={evt.status !== 'cancelled' ? evt.id : undefined}
		/>
	{/if}

	<!-- A ticketed event's headcount is its tickets; RSVPs are for the rest. -->
	{#if !evt.ticketingEnabled}
		<EventRsvps eventId={evt.id} />
	{/if}

	{#if !data.recap.closedReason || evt.recapText}
		<RecapText eventId={evt.id} text={evt.recapText} closedReason={data.recap.closedReason} />
	{/if}

	{#if !data.recap.closedReason || data.recap.photos.length > 0}
		<RecapPhotos eventId={evt.id} eventTitle={evt.title} recap={data.recap} />
	{/if}

	<!--
		Two people posting one gig is the characteristic failure of a community
		calendar, and moderation is the only backstop — so the moderator has to be
		able to see the slot. An empty result says so out loud rather than
		rendering nothing, which reads as "this page doesn't check".
	-->
	<InfoCard title={m.staff_events_id_within_two_hours()}>
		{#if data.nearby.length === 0}
			<p class="text-muted">{m.staff_events_id_nothing_else_within_two_hours()}</p>
		{:else}
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_event()}</th>
					<th>{m.staff_posted_by()}</th>
				{/snippet}
				{#each data.nearby as n (n.id)}
					{@const href = resolve(`/staff/events/${n.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px"><StatusBadge status={n.status} /></td>
						<td class="cell-primary">
							<EntityIdentity ref={n.ref}>
								{#snippet subtitle()}
									<span class="whitespace-nowrap">
										{formatEventTimeRange(n.startsAt, n.endsAt)}
									</span>
								{/snippet}
							</EntityIdentity>
						</td>
						<td>
							{#if n.source === 'cmc'}
								<span class="text-muted">{m.staff_cmc()}</span>
							{:else if n.source === 'band'}
								<EntityChip ref={n.band} />
							{:else}
								<span class="text-muted">{m.staff_events_id_community()}</span>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<ActivityFeedCard
		title={m.staff_history()}
		query={(limit) => getEventHistory(limit ? { id, limit } : { id })}
		toRow={feedItemRow}
		empty={{ title: m.staff_no_recorded_changes() }}
	/>
</PageContent>
