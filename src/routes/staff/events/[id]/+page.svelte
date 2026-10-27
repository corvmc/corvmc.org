<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import LineupEditor, { type LineupChip } from '$lib/components/events/LineupEditor.svelte';
	import ListingEditForm from '$lib/components/events/ListingEditForm.svelte';
	import ListingPosterCard from '$lib/components/events/ListingPosterCard.svelte';
	import RecurringSeriesBar from '$lib/components/events/RecurringSeriesBar.svelte';
	import RepeatEventAction from '$lib/components/events/RepeatEventAction.svelte';
	import SpaceHoldCard from '$lib/components/events/SpaceHoldCard.svelte';
	import ListingTicketing from '$lib/components/events/ListingTicketing.svelte';
	import {
		PublishEventAction,
		UnpublishEventAction,
		CancelEventAction,
		DeleteEventAction
	} from '$lib/components/actions';
	import { getStaffEventPage, setStaffEventLineup } from '$lib/remote/events.remote';
	import {
		approveListing,
		rejectListing,
		searchBandsForListing
	} from '$lib/remote/community-events.remote';
	import { rowLink } from '$lib/actions/row-link';
	import RecapPhotos from './RecapPhotos.svelte';
	import RecapText from './RecapText.svelte';
	import EventRsvps from './EventRsvps.svelte';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import { formatTime, fullDate } from '$lib/utils/format';

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

<PageHeader width="3xl" title={evt.title} subtitle="Event">
	<div class="flex flex-wrap items-center gap-2">
		{#if isProduction}
			<!-- One entry, not two. "Manage production" and "Add production" sat
			     side by side before a production existed, and a first-timer picked
			     the first — landing on a console that told them to go back where
			     they came from. Opening one now lives in that console's empty
			     state, which is the page that explains what a production is
			     (#976). -->
			<Button href={resolve(`/staff/events/${id}/production`)} variant="default" size="sm" outline>
				{data.production ? 'Manage production' : 'Open a production'}
			</Button>
		{/if}

		{#if evt.ticketingEnabled}
			<Button href="/staff/events/{evt.id}/check-in" variant="ghost" size="sm">Check-in</Button>
		{/if}

		{#if evt.kind === 'market'}
			<Button href={resolve(`/staff/events/${id}/vendors`)} variant="ghost" size="sm"
				>Vendors</Button
			>
		{/if}

		{#if evt.status !== 'cancelled' && !editing}
			<Button variant="ghost" size="sm" onclick={startEditing}>Edit</Button>
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
				label="Approve"
				successToast="Approved and published"
				variant="success"
				size="sm"
				onsuccess={() => invalidateAll()}
			>
				{#snippet form()}
					<input {...approveListing.fields.eventId.as('hidden', evt.id)} />
					<p class="py-2">Publish this listing and let the member know it was approved?</p>
				{/snippet}
			</Action>
			<Action
				action={rejectListing}
				label="Turn down"
				successToast="Sent back to the member"
				variant="warning"
				size="sm"
				onsuccess={() => invalidateAll()}
			>
				{#snippet form()}
					<input {...rejectFields.eventId.as('hidden', evt.id)} />
					<FormField
						field={rejectFields.notes}
						type="textarea"
						label="What needs to change?"
						description="The member sees this. Without it they can't fix the listing."
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
			<span class="text-muted">Published {fullDate(evt.publishedAt)}</span>
		{/if}
	</div>

	<!-- What was already said, before saying it again. -->
	{#if evt.status === 'rejected' && evt.reviewNotes}
		<Alert type="warning">
			Turned down. Staff note: "{evt.reviewNotes}"
		</Alert>
	{/if}

	<!--
		Who is accountable, which is a different record per source: a band manages
		its own gig, a member owns their listing, and the collective's own shows
		answer with neither. This also absorbs what used to be a second "Created
		by" card saying the same name and email over again.
	-->
	<InfoCard title="Posted by">
		{#if isProduction}
			<p class="text-sm font-medium">CMC</p>
		{:else if isBandEvent}
			<p class="flex flex-wrap items-center gap-2 text-sm">
				{#if detail.bandRef}
					<EntityChip ref={detail.bandRef} />
				{:else}
					<span class="font-medium">a band</span>
				{/if}
			</p>
		{:else}
			<p class="flex flex-wrap items-center gap-2 text-sm">
				{#if detail.submitter}
					<EntityChip ref={detail.submitter} />
				{:else}
					<span class="font-medium">Unknown member</span>
				{/if}
				{#if detail.creator?.email}
					<span class="text-muted">{detail.creator.email}</span>
				{/if}
			</p>
		{/if}

		<p class="mt-1 text-muted">Submitted {fullDate(evt.createdAt)}</p>

		<!-- Community only: standing is a member-level fact, and whether a band
		     can be flagged the same way is a different axis. -->
		{#if isCommunityEvent && detail.submitterStanding && detail.submitterStanding.status !== 'none'}
			<Alert type="warning" class="mt-2">
				This member's listings are checked before they publish, after a report was upheld against
				one of them.
				{#if detail.submitterStanding.reason}
					Staff note: "{detail.submitterStanding.reason}"
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
		<InfoCard title="Production">
			<div class="flex flex-wrap items-center gap-2">
				<StatusBadge status={data.production.status} label />
				{#if data.production.producerName}
					<span class="text-muted">Produced by {data.production.producerName}</span>
				{:else}
					<span class="text-muted">No producer yet</span>
				{/if}
			</div>

			{#if data.production.loadInAt}
				<p class="mt-2 text-sm">Load-in {fullDate(data.production.loadInAt)}</p>
			{:else}
				<p class="mt-2 text-muted">Load-in, soundcheck and curfew are not set yet.</p>
			{/if}

			<Button
				href={resolve(`/staff/events/${id}/production`)}
				variant="default"
				size="sm"
				outline
				class="mt-3"
			>
				Open the console
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
			onsaved={() => {
				editing = false;
				refresh();
			}}
			oncancel={() => (editing = false)}
		/>

		<InfoCard title="Bill">
			<!--
				The bill saves separately. `setStaffEventLineup` decides consent from
				the event's source, and folding it into `updateEvent` would put that
				rule behind a form the console also posts.
			-->
			<div>
				<Form
					remote={setStaffEventLineup}
					successToast="Bill updated"
					onsuccess={() => {
						editing = false;
						refresh();
					}}
				>
					<input {...setStaffEventLineup.fields.eventId.as('hidden', evt.id)} />
					<input {...setStaffEventLineup.fields.lineup.as('hidden', JSON.stringify(lineup))} />
					<LineupEditor bind:value={lineup} search={searchBandsForListing} />
					<div class="mt-3"><SubmitButton label="Save bill" /></div>
				</Form>
			</div>
		</InfoCard>
	{/if}

	<InfoCard title="Event">
		<p class="text-xl font-medium">{fullDate(evt.startsAt)}</p>
		<p class="text-muted">
			{#if evt.doorsAt}
				Doors {formatTime(evt.doorsAt)} · Show {formatEventTimeRange(evt.startsAt, evt.endsAt)}
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
				Tickets ↗
			</a>
		{/if}

		{#if detail.lineup.length > 0}
			<div class="mt-4 border-t border-base-200 pt-4">
				<p class="mb-2 text-muted font-medium">On the bill</p>
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
		onchange={refresh}
	/>

	<ListingTicketing
		event={evt}
		ticketStats={detail.ticketStats}
		ticketMoney={detail.ticketMoney}
		tickets={detail.tickets}
		onchange={refresh}
	/>

	{#if showsHold}
		<SpaceHoldCard
			venueName={evt.venueName}
			venueIsPrimary={evt.venueIsPrimary}
			reservation={detail.linkedReservation}
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
	<InfoCard title="Within two hours">
		{#if data.nearby.length === 0}
			<p class="text-muted">Nothing else within two hours of this show.</p>
		{:else}
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Event</th>
					<th>Posted by</th>
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
								<span class="text-muted">CMC</span>
							{:else if n.source === 'band'}
								<EntityChip ref={n.band} />
							{:else}
								<span class="text-muted">Community</span>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>
</PageContent>
