<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { parseTagList } from '#lib/utils/unique-tags.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto, refreshAll } from '$app/navigation';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import LineupEditor, { type LineupChip } from '#lib/components/events/LineupEditor.svelte';
	import ListingEditForm from '#lib/components/events/ListingEditForm.svelte';
	import ListingShare from '#lib/components/events/ListingShare.svelte';
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
	import { approveListing, rejectListing } from '#lib/remote/community-events.remote.js';
	import { searchBillActs } from '#lib/remote/external-acts.remote.js';
	import RecapPhotos from './RecapPhotos.svelte';
	import RecapText from '#lib/components/events/RecapText.svelte';
	import EventRsvps from './EventRsvps.svelte';
	import EventSidebar from './EventSidebar.svelte';
	import ProductionTab from './production/ProductionTab.svelte';
	import VendorsTab from './VendorsTab.svelte';
	import {
		eventTabHref,
		eventTabs,
		parseEventTab,
		settlementHref,
		showsSettle,
		type EventTab
	} from './tabs';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { formatDateShort, formatTime, fullDate } from '#lib/utils/format.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	/**
	 * The event: one page with a fixed header, a sidebar and tabs (#3270).
	 * Listing is everything public-facing; Production is a CMC show's
	 * back-of-house; Vendors is a market's. Writes take `event.manage` or the
	 * show's committee; the guard is `requireListingWriter`, on the remotes.
	 */
	const id = $derived(params.id);
	const data = $derived(await getStaffEventPage(id));
	const evt = $derived(data.detail.event);
	const detail = $derived(data.detail);

	const isProduction = $derived(evt.source === 'cmc');
	const isBandEvent = $derived(evt.source === 'band');
	const isCommunityEvent = $derived(evt.source === 'community');

	const tab = $derived(parseEventTab(page.url.searchParams.get('tab'), evt));
	const TAB_LABELS: Record<EventTab, () => string> = {
		listing: m.staff_events_id_tab_listing_label,
		production: m.staff_events_id_tab_production_label,
		vendors: m.staff_vendors_label,
		history: m.staff_events_id_tab_history_label
	};
	const tabs = $derived(
		eventTabs(evt).map((key) => ({
			key,
			label: TAB_LABELS[key](),
			href: eventTabHref(id, key)
		}))
	);

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
		lineup = detail.lineup.map((l) => ({
			name: l.name,
			bandId: l.bandId ?? undefined,
			actId: l.actId ?? undefined
		}));
		editing = true;
	}

	// Held, or a CMC show that ought to say whether it is. A band gig or a
	// community listing with no hold has no question for this card to answer.
	const showsHold = $derived(isProduction || !!detail.linkedReservation);

	// Our own listings and a club's sessions repeat; a band's gig or a community
	// listing is someone else's to schedule.
	const canRepeat = $derived(
		(evt.source === 'cmc' || evt.source === 'group') && evt.status !== 'cancelled'
	);
</script>

<PageHeader title={evt.title} width="full" menuLabel={m.staff_events_id_more_label()}>
	{#snippet badge()}
		<StatusBadge status={evt.status} label />
	{/snippet}

	{#if evt.status === 'pending_review'}
		<!-- Turning it down needs a reason: `rejected` exists so the member can fix
		     and resubmit. -->
		<Action
			action={rejectListing}
			label={m.staff_events_id_turn_down_label()}
			data-testid="reject-listing"
			successToast={m.staff_events_id_sent_back_member_toast()}
			variant="ghost"
			onsuccess={() => refreshAll()}
		>
			{#snippet form()}
				<input {...rejectFields.eventId.as('hidden', evt.id)} />
				<FormField
					field={rejectFields.notes}
					type="textarea"
					label={m.staff_events_id_what_needs_change_label()}
					description={m.staff_events_id_description_body()}
				/>
			{/snippet}
		</Action>
	{/if}

	{#if evt.status !== 'cancelled'}
		<details class="dropdown dropdown-end" data-testid="share">
			<summary class="btn btn-ghost btn-sm">{m.staff_events_id_share_label()}</summary>
			<div class="dropdown-content dropdown-panel w-72 p-3">
				<ListingShare
					eventId={evt.id}
					shortCode={evt.shortCode}
					title={evt.title}
					published={evt.status === 'published'}
				/>
			</div>
		</details>
	{/if}

	{#snippet primary()}
		{#if showsSettle(evt, new Date())}
			<Button variant="primary" href={settlementHref(evt.id)} data-testid="settle-event">
				{m.staff_events_id_settle_event_label()}
			</Button>
		{:else if evt.status === 'draft' && data.canPublish}
			<PublishEventAction eventId={evt.id} />
		{:else if evt.status === 'pending_review'}
			<!-- Approve, not Publish: approving also clears the last turn-down note
			     and tells the member. -->
			<Action
				action={approveListing}
				label={m.staff_approve_label()}
				data-testid="approve-listing"
				successToast={m.staff_events_id_approved_published_toast()}
				variant="primary"
				onsuccess={() => refreshAll()}
			>
				{#snippet form()}
					<input {...approveListing.fields.eventId.as('hidden', evt.id)} />
					<!-- Two people posting one gig is the characteristic failure of a
					     community calendar: warn, and approve anyway. -->
					{#if isCommunityEvent && data.nearby.length > 0}
						<Alert type="warning">
							<p>{m.staff_events_id_possible_duplicate_text()}</p>
							<ul class="mt-1 list-disc pl-5">
								{#each data.nearby as n (n.id)}
									<li>
										<a class="link" href={resolve(`staff/events/${n.id}`)}>{n.ref.title}</a>
										<span class="text-muted">· {formatEventTimeRange(n.startsAt, n.endsAt)}</span>
									</li>
								{/each}
							</ul>
						</Alert>
					{/if}
					<p class="py-2">{m.staff_events_id_publish_listing_let_member_know_text()}</p>
				{/snippet}
			</Action>
		{/if}
	{/snippet}

	{#snippet menu()}
		{#if evt.ticketingEnabled}
			<Button href={resolve(`staff/events/${evt.id}/check-in`)}>
				{m.staff_events_id_check_label()}
			</Button>
		{/if}
		{#if canRepeat && !data.recurringSeries}
			<RepeatEventAction eventId={evt.id} startsAt={evt.startsAt} onsuccess={refresh} />
		{/if}
		{#if evt.status === 'published' && data.canPublish}
			<UnpublishEventAction eventId={evt.id} />
		{/if}
		{#if data.canManage}
			{#if evt.status !== 'cancelled'}
				<CancelEventAction eventId={evt.id} />
			{/if}
			<DeleteEventAction eventId={evt.id} />
		{/if}
	{/snippet}
</PageHeader>

<PageContent>
	<div class="flex flex-col gap-1">
		<p class="text-muted" data-testid="event-when">
			{fullDate(evt.startsAt)} ·
			{#if evt.doorsAt}
				{m.staff_events_id_doors_show_text({
					formatTime: formatTime(evt.doorsAt),
					formatEventTimeRange: formatEventTimeRange(evt.startsAt, evt.endsAt)
				})}
			{:else}
				{formatEventTimeRange(evt.startsAt, evt.endsAt)}
			{/if}
			{#if evt.venueName ?? evt.location}
				· {evt.venueName ?? evt.location}
			{/if}
		</p>
		<!-- Who is accountable, which is a different record per source: a band
		     manages its own gig, a member owns their listing, CMC its own shows. -->
		<p class="flex flex-wrap items-center gap-1 text-subtle text-sm" data-testid="posted-by">
			<span>{m.staff_events_id_posted_by_text()}</span>
			{#if isProduction}
				<span>{m.staff_cmc_text()}</span>
			{:else if isBandEvent && detail.bandRef}
				<EntityChip ref={detail.bandRef} />
			{:else if !isBandEvent && detail.submitter}
				<EntityChip ref={detail.submitter} />
			{:else}
				<span>{m.staff_events_id_unknown_member_text()}</span>
			{/if}
			<span>· {formatDateShort(evt.createdAt)}</span>
		</p>
	</div>

	<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
		<div class="flex min-w-0 flex-col gap-6">
			<div data-testid="event-tabs"><TabBar {tabs} active={tab} /></div>

			{#if tab === 'listing'}
				<div class="flex flex-col gap-6" data-testid="tab-listing">
					<!-- What was already said, before saying it again. -->
					{#if evt.status === 'rejected' && evt.reviewNotes}
						<Alert type="warning">
							{m.staff_events_id_turned_down_staff_note_body({ reviewNotes: evt.reviewNotes })}
						</Alert>
					{/if}

					<!-- Community only: standing is a member-level fact. -->
					{#if isCommunityEvent && detail.submitterStanding && detail.submitterStanding.status !== 'none'}
						<Alert type="warning">
							{m.staff_events_id_member_s_listings_checked_before_body()}
							{#if detail.submitterStanding.reason}
								{m.staff_staff_note_body({ reason: detail.submitterStanding.reason })}
							{/if}
						</Alert>
					{/if}

					{#if data.recurringSeries}
						<RecurringSeriesBar
							eventId={evt.id}
							series={data.recurringSeries}
							onchange={refresh}
							onrescheduled={(next) => goto(resolve(`staff/events/${next}`))}
						/>
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

						<!-- A CMC show's acts are edited on the Production tab (#3272). -->
						{#if evt.source === 'cmc'}
							<InfoCard title={m.staff_events_id_bill_title()}>
								<ul class="space-y-1 text-sm">
									{#each detail.lineup as act (act.id)}
										<li class="font-medium">{act.name}</li>
									{/each}
								</ul>
								<div class="mt-3">
									<Button href={eventTabHref(id, 'production')} variant="ghost" size="sm">
										{m.staff_events_id_bill_edit_lineup_label()}
									</Button>
								</div>
							</InfoCard>
						{:else}
							<InfoCard title={m.staff_events_id_bill_title()}>
								<!--
								The bill saves separately. `setStaffEventLineup` decides consent from
								the event's source, and folding it into `updateEvent` would put that
								rule behind a form the console also posts.
							-->
								<Form
									remote={setStaffEventLineup}
									successToast={m.staff_events_id_bill_updated_toast()}
									onsuccess={() => {
										editing = false;
										refresh();
									}}
								>
									<input {...setStaffEventLineup.fields.eventId.as('hidden', evt.id)} />
									<LineupEditor
										field={setStaffEventLineup.fields.lineup}
										bind:value={lineup}
										search={(q) => searchBillActs({ eventId: evt.id, q })}
									/>
									<div class="mt-3">
										<SubmitButton label={m.staff_events_id_save_bill_label()} />
									</div>
								</Form>
							</InfoCard>
						{/if}
					{:else}
						<InfoCard title={m.staff_event_title()}>
							{#snippet header(title)}
								<div class="flex flex-wrap items-center justify-between gap-2">
									<CardTitle>{title}</CardTitle>
									{#if evt.status !== 'cancelled' || data.canManage}
										<Button
											variant="ghost"
											size="sm"
											data-testid="edit-listing"
											onclick={startEditing}
										>
											{m.staff_edit_label()}
										</Button>
									{/if}
								</div>
							{/snippet}

							{#if evt.externalTicketUrl}
								<a
									href={evt.externalTicketUrl}
									class="link text-sm"
									target="_blank"
									rel="noopener noreferrer external"
								>
									{m.staff_events_id_tickets_text()}
								</a>
							{/if}

							{#if detail.lineup.length > 0}
								<div class="mt-4 border-t border-base-200 pt-4">
									<p class="mb-2 text-muted font-medium">{m.staff_events_id_bill_2_text()}</p>
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
									{#if evt.source === 'cmc'}
										<div class="mt-2">
											<Button href={eventTabHref(id, 'production')} variant="ghost" size="sm">
												{m.staff_events_id_bill_edit_lineup_label()}
											</Button>
										</div>
									{/if}
								</div>
							{/if}

							{#if evt.description}
								<div class="mt-4 border-t border-base-200 pt-4">
									<p class="whitespace-pre-wrap">{evt.description}</p>
								</div>
							{/if}

							{#if parseTagList(evt.tags).length > 0}
								<div class="mt-4 flex flex-wrap gap-1 pt-4 rule-top">
									{#each parseTagList(evt.tags) as tag (tag)}
										<Badge variant="outline">{tag}</Badge>
									{/each}
								</div>
							{/if}
						</InfoCard>
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
						<RecapText
							eventId={evt.id}
							text={evt.recapText}
							closedReason={data.recap.closedReason}
						/>
					{/if}

					{#if !data.recap.closedReason || data.recap.photos.length > 0}
						<RecapPhotos eventId={evt.id} eventTitle={evt.title} recap={data.recap} />
					{/if}
				</div>
			{:else if tab === 'production'}
				<ProductionTab eventId={evt.id} />
			{:else if tab === 'vendors'}
				<VendorsTab eventId={evt.id} />
			{:else}
				<ActivityFeedCard
					title={m.staff_history_title()}
					query={(limit) => getEventHistory(limit ? { id, limit } : { id })}
					toRow={feedItemRow}
					empty={{ title: m.staff_no_recorded_changes_title() }}
				/>
			{/if}
		</div>

		<EventSidebar {data} onchange={refresh} />
	</div>
</PageContent>
