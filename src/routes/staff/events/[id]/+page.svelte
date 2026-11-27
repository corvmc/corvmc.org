<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto, refreshAll } from '$app/navigation';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
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
	import { getEventHistory, getStaffEventPage } from '#lib/remote/events.remote.js';
	import { ActivityFeedCard, feedItemRow } from '#lib/components/ui/ActivityFeed/index.js';
	import { approveListing, rejectListing } from '#lib/remote/community-events.remote.js';
	import RecapPhotos from './RecapPhotos.svelte';
	import RecapText from '#lib/components/events/RecapText.svelte';
	import EventRsvps from './EventRsvps.svelte';
	import ListingForm from './ListingForm.svelte';
	import EventSidebar from './EventSidebar.svelte';
	import ProductionTab from './production/ProductionTab.svelte';
	import SettleDialog from './SettleDialog.svelte';
	import VendorsTab from './VendorsTab.svelte';
	import {
		eventTabHref,
		eventTabs,
		parseEventTab,
		settleReadOnly,
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

	// The form seeds from the event once, so a save re-keys it after the page
	// has the saved values.
	let formKey = $state(0);
	async function saved() {
		await getStaffEventPage(id).refresh();
		formKey += 1;
	}

	let settleOpen = $state(false);

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
		{#if data.settle?.settlement?.settled}
			<Badge variant="success">{m.staff_production_state_settled_label()}</Badge>
		{/if}
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
			{#if data.settle?.settlement}
				<Button variant="primary" onclick={() => (settleOpen = true)} data-testid="settle-event">
					{settleReadOnly(data.settle.settlement)
						? m.staff_events_id_view_settlement_label()
						: m.staff_events_id_settle_event_label()}
				</Button>
			{:else}
				<!-- No production yet: the Production tab opens one. -->
				<Button
					variant="primary"
					href={eventTabHref(evt.id, 'production')}
					data-testid="settle-event"
				>
					{m.staff_events_id_settle_event_label()}
				</Button>
			{/if}
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

{#if data.settle?.settlement}
	<SettleDialog
		bind:open={settleOpen}
		eventId={evt.id}
		settlement={data.settle.settlement}
		canCount={data.settle.canCount}
		canPayout={data.settle.canPayout}
	/>
{/if}

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
			<TabBar {tabs} active={tab} />

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

					{#key formKey}
						<ListingForm
							event={evt}
							lineup={detail.lineup}
							linkedReservation={detail.linkedReservation}
							venues={data.venues}
							cancelled={evt.status === 'cancelled'}
							readOnly={evt.status === 'cancelled' && !data.canManage}
							onsaved={saved}
						/>
					{/key}

					{#if data.recurringSeries}
						<RecurringSeriesBar
							eventId={evt.id}
							series={data.recurringSeries}
							onchange={refresh}
							onrescheduled={(next) => goto(resolve(`staff/events/${next}`))}
						/>
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
