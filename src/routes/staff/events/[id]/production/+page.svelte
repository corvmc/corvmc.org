<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { getStaffEventProduction } from '$lib/remote/events.remote';
	import ListingEditForm from '$lib/components/events/ListingEditForm.svelte';
	import ListingPosterCard from '$lib/components/events/ListingPosterCard.svelte';
	import RecurringSeriesBar from '$lib/components/events/RecurringSeriesBar.svelte';
	import SpaceHoldCard from '$lib/components/events/SpaceHoldCard.svelte';
	import ListingTicketing from '$lib/components/events/ListingTicketing.svelte';
	const createProductionFields = createProduction.fields;
	import RepeatEventAction from '$lib/components/events/RepeatEventAction.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import {
		formatDateShort,
		formatDateTime,
		formatTimeRange,
		fullDate,
		toLocalDate,
		toLocalDateTime
	} from '$lib/utils/format';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { goto } from '$app/navigation';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ShiftFormFields from '$lib/components/volunteer/ShiftFormFields.svelte';
	import { createShift } from '$lib/remote/volunteer.remote';
	import { createProduction } from '$lib/remote/productions.remote';
	import { listActInDirectory } from '$lib/remote/external-acts.remote';
	import { applyDutyList } from '$lib/remote/duty-lists.remote';
	import {
		updateProduction,
		setProductionProducer,
		openHostShift
	} from '$lib/remote/productions.remote';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import ProductionStatusAction from './ProductionStatusAction.svelte';
	import { isTerminalProduction } from '$lib/production/status';
	import RunOfShowPanel from './RunOfShowPanel.svelte';
	import SettlementPanel from './SettlementPanel.svelte';
	import ShowBudgetCard from './ShowBudgetCard.svelte';
	import DeliverablesCard from './DeliverablesCard.svelte';
	import ArtifactRequestsPanel from './ArtifactRequestsPanel.svelte';
	import { TAB_KEYS, TAB_LABELS, parseTab, type TabKey } from './tabs';
	import { SvelteSet } from 'svelte/reactivity';
	import { replaceState } from '$app/navigation';

	let id = $derived(page.params.id!);

	/**
	 * Everything the page needs, in one round trip rather than four.
	 *
	 * A declaration below a top-level `await` is blocked on it, and a remote
	 * query does not start fetching until something reads it — so four
	 * independent queries written as four awaited declarations go out strictly
	 * one after another, and the page commits as a single batch, which means
	 * even the `<h1>` waits for the last of them. `Promise.all` reads all four
	 * in the same tick, so they overlap.
	 *
	 * Not cosmetic. The URL commits before any of this has arrived, so the chain
	 * is dead time on every visit — and it is what
	 * `e2e/staff-event-reserve-space.e2e.ts` was intermittently timing out
	 * against on CI once #235 grew it from three queries to four.
	 *
	 * Shifts leave out the cancelled ones: this card answers "is this show
	 * staffed", and a called-off shift is not staffing. The shift list is where
	 * you go to see what was called off.
	 */
	const loaded = $derived(await getStaffEventProduction(id));

	let data = $derived(loaded.detail);
	const recurringSeries = $derived(loaded.recurringSeries);
	const shifts = $derived(loaded.shifts);
	const volunteerRoles = $derived(loaded.volunteerRoles);
	const dutyLists = $derived(loaded.dutyLists);
	const venues = $derived(loaded.venues);
	// Work orders with no window — the advance half of an applied duty list. They
	// are a separate list rather than rows in the table below because they have no
	// time to sort by and no confirmed/capacity story worth printing: what a
	// producer wants from them is what is still open and by when.
	const advance = $derived(loaded.advance);
	const riders = $derived(loaded.riders);
	const productionRecord = $derived(loaded.production);
	const productionLocked = $derived(
		productionRecord ? isTerminalProduction(productionRecord.status) : false
	);
	const hostShift = $derived(loaded.hostShift);
	const runOfShow = $derived(loaded.runOfShow);
	const settlement = $derived(loaded.settlement);
	const budget = $derived(loaded.budget);
	/** The advance question: who has told us nothing at all. */
	const ridersMissing = $derived(riders.filter((r) => r.empty).length);

	const evt = $derived(data.event);

	const liveVolunteerRoles = $derived(volunteerRoles.filter((r) => r.isActive));

	/**
	 * Only a show CMC produces has a production.
	 *
	 * Everything on this page — the room, the ticket ledger, the volunteer
	 * shifts, selling through our own checkout — is meaningless for a gig at
	 * someone else's venue that a member posted. The general view at
	 * `/staff/events/[id]` is where every source belongs; this is the
	 * specialisation, and a hand-typed URL should land back there rather than
	 * render an empty shell.
	 */
	$effect(() => {
		if (evt.source !== 'cmc') void goto(resolve(`/staff/events/${id}`), { replaceState: true });
	});

	/**
	 * Volunteers arrive when the doors do, not at downbeat, so a shift scheduled
	 * from this page starts at `doorsAt` when the event has one. The end falls
	 * back to the picked role's own default length for an event with no end time
	 * — only community listings are allowed one, but they are allowed one.
	 */
	let shiftRoleId = $state('');
	const shiftStart = $derived(toLocalDateTime(evt.doorsAt ?? evt.startsAt));
	const shiftEnd = $derived.by(() => {
		if (evt.endsAt) return toLocalDateTime(evt.endsAt);
		const role = volunteerRoles.find((r) => r.id === shiftRoleId);
		const minutes = role?.defaultDurationMinutes ?? 4 * 60;
		return toLocalDateTime(new Date((evt.doorsAt ?? evt.startsAt).getTime() + minutes * 60_000));
	});
	const shiftCapacity = $derived(
		String(volunteerRoles.find((r) => r.id === shiftRoleId)?.defaultCapacity ?? 1)
	);

	// The select has no placeholder option, so a bound value matching nothing
	// leaves nothing selected — which posts an empty role instead of the one on
	// screen. Guarded so it seeds once and never clobbers an actual choice.
	$effect(() => {
		if (shiftRoleId) return;
		const first = volunteerRoles.find((r) => r.isActive);
		if (first) shiftRoleId = first.id;
	});

	// ── Edit ──────────────────────────────────────────────────────────────
	// The form is the listing's (`ListingEditForm`), shared with the listing
	// page until #1950 takes it off this one.
	let editing = $state(false);

	function refresh() {
		void getStaffEventProduction(id).refresh();
	}

	// ── Tabs ──────────────────────────────────────────────────────────────
	// Read out of the URL once, on mount, so a reload or a copied link lands on
	// the right panel. `tab` is the source of truth from then on.
	const initialTab = parseTab(page.url.searchParams.get('tab'));
	let tab = $state<TabKey>(initialTab);
	let tabBarEl = $state<HTMLElement | null>(null);

	// Keep-alive. A plain {#if} would unmount the Overview panel on tab change
	// and silently discard a half-typed edit — Form's `guard` only fires on
	// navigation, and switching tabs is not one.
	const visited = new SvelteSet<TabKey>([initialTab]);
	$effect(() => {
		visited.add(tab);
	});

	// `replaceState` (shallow routing) rather than `goto(..., { replaceState })`,
	// which is what the filter bars use. A tab change is not a navigation, but
	// `goto` is one, and `FormGuard` hooks `beforeNavigate`: with the edit form
	// dirty, every tab click would cancel the navigation and pop "You have
	// unsaved changes", whose <dialog> then swallows pointer events for the whole
	// page. Shallow routing rewrites the address bar and nothing else, which is
	// all mirroring local state wants.
	$effect(() => {
		const href = withQuery(
			resolve(`/staff/events/${id}/production`),
			tab === 'overview' ? '' : `tab=${tab}`
		);
		if (location.pathname + location.search !== href) {
			replaceState(href, {});
		}
	});

	const tabs = $derived(TAB_KEYS.map((key) => ({ key, label: TAB_LABELS[key] })));

	// ── Production form state ─────────────────────────────────────────────
	const productionFields = updateProduction.fields;
	const producerFields = setProductionProducer.fields;

	// One date for all five times: the listing already refuses to span two dates,
	// so five date fields would be five chances to disagree with each other.
	let productionDate = $state('');
	$effect(() => {
		if (!productionRecord) return;
		productionDate = toLocalDate(productionRecord.loadInAt ?? evt.startsAt);
	});
</script>

<!-- Back where this row came from: a production is on /staff/events, and
     everything else is only ever reachable from the calendar. -->
<!--
	The lifecycle — publish, approve, turn down, unpublish, cancel, delete — is
	the general view's, at `/staff/events/[id]`. This page owns the production:
	the room, the ticket ledger, the poster, the staffing. One rule, so nobody
	has to remember which page a given button lives on.
-->
<PageHeader
	width="3xl"
	title={evt.title}
	subtitle="Production"
	crumb="Production"
	parent={{ label: evt.title, href: resolve('/staff/events/[id]', { id }) }}
>
	<div class="flex items-center gap-2">
		{#if evt.ticketingEnabled}
			<Button href="/staff/events/{evt.id}/check-in" variant="ghost" size="sm">Check-in</Button>
		{/if}

		{#if evt.status !== 'cancelled' && !editing}
			<Button variant="ghost" size="sm" onclick={() => (editing = true)}>Edit</Button>
		{/if}
	</div>
</PageHeader>
<PageContent width="3xl">
	<div bind:this={tabBarEl}>
		<TabBar {tabs} active={tab} collapse onchange={(key) => (tab = key as TabKey)} />
	</div>

	{#if visited.has('overview')}
		<div
			role="tabpanel"
			aria-labelledby="tab-overview"
			class="space-y-6"
			class:hidden={tab !== 'overview'}
		>
			<!--
				When the show is. These four were on the page only as seeds for the
				edit form, so the one question a production console is opened to
				answer needed you to click Edit to read it (#1068).
			-->
			<InfoCard title="The night">
				<DefinitionList>
					<Fact label="Doors">
						{evt.doorsAt ? formatEventTimeRange(evt.doorsAt, null) : 'Not set'}
					</Fact>
					<Fact label="Show">{formatEventTimeRange(evt.startsAt, evt.endsAt)}</Fact>
					<Fact label="Where">
						{evt.venueName ?? evt.location ?? 'The practice space'}
					</Fact>
				</DefinitionList>

				{#if evt.description}
					<p class="mt-3 text-muted">{evt.description}</p>
				{/if}
			</InfoCard>

			<DeliverablesCard
				eventId={evt.id}
				items={loaded.deliverables}
				committees={loaded.deliverableCommittees}
			/>

			<!-- Status -->
			<div class="flex items-center gap-2">
				<StatusBadge status={evt.status} />
				{#if evt.publishedAt}
					<span class="text-muted">Published {fullDate(evt.publishedAt)}</span>
				{/if}
			</div>

			{#if recurringSeries}
				<RecurringSeriesBar eventId={evt.id} series={recurringSeries} onchange={refresh} />
			{:else if evt.status !== 'cancelled'}
				<RepeatEventAction eventId={evt.id} startsAt={evt.startsAt} onsuccess={refresh} />
			{/if}

			{#if editing}
				<ListingEditForm
					event={evt}
					linkedReservation={data.linkedReservation}
					{venues}
					onsaved={() => {
						editing = false;
						refresh();
					}}
					oncancel={() => (editing = false)}
				/>
			{/if}

			<!--
			The production record: the ops half of the night, opened from the event
			page and worked on here. Null until somebody opens one — a listing on the
			guide is not a production, and most of them never become one.
		-->
			{#if productionRecord}
				<InfoCard title="Production">
					{#snippet header(title)}
						<div class="flex flex-wrap items-center justify-between gap-2">
							<CardTitle>{title}</CardTitle>
							<div class="flex items-center gap-2">
								<StatusBadge status={productionRecord.status} label />
								<ProductionStatusAction production={productionRecord} eventId={evt.id} />
							</div>
						</div>
					{/snippet}

					<!--
					Who is running the night, as a claim rather than a picker, and its own
					form rather than a field on the one below: taking a job is a single
					act that should not wait on a Save, and there is no list of candidates
					a picker could offer — the capability matrix names no production lead.
				-->
					{#if productionRecord.closedAt}
						<!-- `updatedAt` is not this date: it moves on any later write. -->
						<p class="text-muted text-sm">
							Closed {formatDateTime(productionRecord.closedAt)}{productionRecord.closedByName
								? ` by ${productionRecord.closedByName}`
								: ''}
						</p>
					{/if}
					{#if productionLocked}
						<p class="text-muted text-sm">
							This show is {productionRecord.status}, so it is read-only.
						</p>
					{/if}
					<!-- A terminal show is the past. Disabled here for clarity; the server refuses
					     the writes either way. -->
					<fieldset disabled={productionLocked} class="contents">
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-muted">Producer</span>
							<!-- The person running the night, reachable. It was their name as
						     a bare string. -->
							{#if productionRecord.producer}
								<EntityChip ref={productionRecord.producer} />
							{:else}
								<span class="font-medium">Nobody yet</span>
							{/if}
							<Form remote={setProductionProducer} successToast="Producer updated">
								<input {...producerFields.id.as('hidden', productionRecord.id)} />
								<input {...producerFields.eventId.as('hidden', evt.id)} />
								<input
									{...producerFields.producer.as(
										'hidden',
										productionRecord.producerUserId ? 'none' : 'me'
									)}
								/>
								<SubmitButton
									label={productionRecord.producerUserId ? 'Hand it back' : 'I am producing this'}
									variant="ghost"
									size="xs"
								/>
							</Form>
						</div>

						<!-- Who runs the night, which is not always who booked it. A shift
					     rather than a field: the producer opens it, and a host claims
					     it through the same pipeline as any other volunteer, so the
					     handover carries confirmation and hours with it (#932). -->
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-muted">Host</span>
							{#if hostShift && hostShift.hosts.length > 0}
								{#each hostShift.hosts as host (host.signupId)}
									<span class="font-medium">{host.name}</span>
									<StatusBadge status={host.status} />
								{/each}
							{:else if hostShift}
								<span class="font-medium">Shift open, nobody on it</span>
								<a
									class="link text-sm"
									href={resolve(`/staff/volunteer/shifts/${hostShift.workOrderId}`)}
								>
									Find somebody
								</a>
							{:else}
								<!-- "No host yet", not "Nobody yet": the Producer line above
							     already says that, and `productions.e2e.ts` reads it by
							     text — two matches make its locator ambiguous. -->
								<span class="font-medium">No host yet</span>
								<Form remote={openHostShift} successToast="Host shift opened">
									<input {...openHostShift.fields.eventId.as('hidden', evt.id)} />
									<SubmitButton label="Open a host shift" variant="ghost" size="xs" />
								</Form>
							{/if}
						</div>

						<Form
							remote={updateProduction}
							guard
							successToast="Production updated"
							onsuccess={() => void getStaffEventProduction(id).refresh()}
						>
							<input {...productionFields.id.as('hidden', productionRecord.id)} />
							<input {...productionFields.eventId.as('hidden', evt.id)} />

							<!--
						One date, five times. A production runs inside one night — the
						listing already refuses to span two dates — so repeating the date on
						every field would be five chances to disagree with itself.
					-->
							<FormField
								field={productionFields.loadInDate}
								type="date"
								label="Show date"
								bind:value={productionDate}
							/>
							<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								<FormField field={productionFields.loadInTime} type="time" label="Load-in" />
								<FormField field={productionFields.soundcheckTime} type="time" label="Soundcheck" />
								<FormField field={productionFields.firstSetTime} type="time" label="First set" />
								<FormField field={productionFields.curfewTime} type="time" label="Curfew" />
								<FormField field={productionFields.loadOutTime} type="time" label="Load-out by" />
							</div>
							<input {...productionFields.soundcheckDate.as('hidden', productionDate)} />
							<input {...productionFields.firstSetDate.as('hidden', productionDate)} />
							<input {...productionFields.curfewDate.as('hidden', productionDate)} />
							<input {...productionFields.loadOutDate.as('hidden', productionDate)} />

							<!-- What makes "still needs an opener" answerable. Until a target
						     exists, a two-act bill nobody has finished looks exactly like
						     a two-act bill that is done (#859). -->
							<FormField
								field={productionFields.actsWanted}
								type="select"
								label="Acts wanted"
								value={productionRecord.actsWanted?.toString() ?? ''}
								options={[
									{ value: '', label: 'No target set' },
									...Array.from({ length: 8 }, (_, i) => ({
										value: String(i + 1),
										label: `${i + 1} ${i === 0 ? 'act' : 'acts'}`
									}))
								]}
								description="How many the bill should end up with. Leave it unset if nobody has decided."
							/>

							<FormField
								field={productionFields.billingNotes}
								label="Billing"
								description="What the acts were told about the money, in their words."
							/>
							<FormField
								field={productionFields.hospitalityNotes}
								label="Hospitality"
								description="Green room, food, parking — what the advance promised."
							/>
							<FormField
								field={productionFields.internalNotes}
								label="Internal notes"
								description="Staff only. Never shown to an act."
							/>

							<SubmitButton label="Save production" />
						</Form>
					</fieldset>
				</InfoCard>
			{:else}
				<!-- The page that explains the thing is the page that makes it. This
				     used to point back at the event page, so a first-timer who came
				     here was sent where they had just been, with nothing on screen
				     naming the button (#976). -->
				<InfoCard title="Production">
					<p class="text-muted">
						No production record yet. Open one to plan load-in, soundcheck and curfew.
					</p>
					<Form remote={createProduction} class="mt-3">
						<input {...createProductionFields.eventId.as('hidden', id)} />
						<SubmitButton label="Open a production" variant="primary" size="sm" />
					</Form>
				</InfoCard>
			{/if}

			<ListingPosterCard
				eventId={evt.id}
				posterUrl={data.posterUrl}
				cancelled={evt.status === 'cancelled'}
				onchange={refresh}
			/>
			<SpaceHoldCard
				venueName={evt.venueName}
				venueIsPrimary={evt.venueIsPrimary}
				reservation={data.linkedReservation}
			/>
		</div>
	{/if}

	{#if visited.has('advance')}
		<div
			role="tabpanel"
			aria-labelledby="tab-advance"
			class="space-y-6"
			class:hidden={tab !== 'advance'}
		>
			<ArtifactRequestsPanel
				eventId={evt.id}
				eventTitle={evt.title}
				requests={loaded.artifactRequests}
				acts={loaded.requestableActs}
				onchange={() => getStaffEventProduction(id).refresh()}
			/>

			<!--
			What the bill needs on stage. The advance checklist has always carried a
			task reading "Collect tech riders and stage plots"; this is where the answer
			shows up, and the number worth reading is how many acts have told us
			nothing — a channel count is interesting, an unanswered act is work.

			Always rendered once there is a bill, including when every act is empty:
			hiding it would make "nobody has sent a rider" and "this page doesn't track
			riders" look identical, which is the mistake the staffing card below
			documents.
		-->
			{#if riders.length > 0}
				<InfoCard title="Tech riders">
					{#snippet header(title)}
						<div class="flex items-center justify-between gap-2">
							<CardTitle>{title}</CardTitle>
							{#if ridersMissing > 0}
								<Badge variant="warning">{ridersMissing} not in yet</Badge>
							{/if}
						</div>
					{/snippet}
					<ul class="divide-y divide-base-300">
						{#each riders as act (act.id)}
							<li class="flex flex-wrap items-center gap-2 py-2">
								<span class="font-medium">{act.name}</span>
								{#if act.empty}
									<!-- Three states, not two. A credit with no `directoryEntryId`
									     is not merely silent: `requestableActs` filters on that
									     column, so it cannot be asked at all — and the old copy
									     blamed the act for it (#974). -->
									{#if act.entryId}
										<span class="text-sm text-base-content/60">Nothing sent yet</span>
									{:else}
										<span class="text-sm text-base-content/60">Not in the directory yet</span>
										<Action
											action={listActInDirectory.for(act.id)}
											label="Add to the directory"
											variant="ghost"
											size="xs"
											modalTitle="Add {act.name} to the directory?"
											submitLabel="Add to the directory"
											successToast="{act.name} can be asked now"
											onsuccess={() => getStaffEventProduction(id).refresh()}
										>
											{#snippet form()}
												<input {...listActInDirectory.fields.eventBandId.as('hidden', act.id)} />
												<p class="text-sm">
													This records <strong>{act.name}</strong> as an external act — no page, no membership,
													nothing members can see. It is what makes them askable for a rider, and gives
													them a link to answer on.
												</p>
											{/snippet}
										</Action>
									{/if}
								{:else}
									{#if act.channelCount > 0}
										<Badge>{act.channelCount} ch</Badge>
									{/if}
									{#if act.phantomCount > 0}
										<Badge>{act.phantomCount} × +48V</Badge>
									{/if}
									{#if act.venueProvidedCount > 0}
										<Badge variant="info">{act.venueProvidedCount} from us</Badge>
									{/if}
									{#if act.uploadCount > 0}
										<Badge variant="ghost"
											>{act.uploadCount} file{act.uploadCount === 1 ? '' : 's'}</Badge
										>
									{/if}
								{/if}
								{#if act.slug}
									<!-- Two links, because an advance asks two questions: what the desk has
									     to find, and what is arriving in the van. `getBandPackingPage` has
									     allowed a staff reader all along and nothing offered it (#858). -->
									<div class="ml-auto flex gap-1">
										<Button
											href={resolve('/band/[slug]/rider/list', { slug: act.slug })}
											variant="ghost"
											size="sm"
										>
											Rider
										</Button>
										<Button
											href={resolve('/band/[slug]/packing', { slug: act.slug })}
											variant="ghost"
											size="sm"
										>
											Packing
										</Button>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
					<!-- The check no per-act sheet can run: the desk has one channel
					     count and it is the show that has to fit it (#818). -->
					<div class="mt-2 border-t border-base-300 pt-2">
						<Button href={resolve('/staff/events/[id]/inputs', { id })} variant="ghost" size="sm">
							Input list for the whole bill
						</Button>
					</div>
				</InfoCard>
			{/if}

			<!--
			Volunteer staffing. Gated the same way, for the same reason: within a
			production it is always rendered, because with the card hidden "nobody is
			staffing this show" and "this page doesn't track staffing" look identical,
			and the second reading is how a calendar of events reaches production with
			nothing booked. CMC does not staff a show it isn't producing.
		-->
			<InfoCard title="Volunteer Shifts">
				{#snippet header(title)}
					<div class="flex items-center justify-between gap-2">
						<CardTitle>{title}</CardTitle>
						<div class="flex items-center gap-1">
							{#if dutyLists.length > 0}
								<Action
									action={applyDutyList}
									label="Apply duty list"
									variant="ghost"
									size="sm"
									modalTitle="Apply a duty list to {evt.title}"
									submitLabel="Apply"
									successToast="Work orders created"
									onsuccess={() => getStaffEventProduction(id).refresh()}
								>
									{#snippet form()}
										<input type="hidden" name="eventId" value={evt.id} />
										<FormField
											name="dutyListId"
											label="Duty list"
											type="select"
											options={dutyLists.map((l) => ({ value: l.id, label: l.name }))}
											description="Creates every work order the list describes, timed from this event. Applying the same list twice is refused."
										/>
									{/snippet}
								</Action>
							{/if}
							{#if liveVolunteerRoles.length > 0}
								<Action
									action={createShift}
									label="Schedule a shift"
									variant="ghost"
									size="sm"
									modalTitle="Schedule a shift for {evt.title}"
									submitLabel="Create"
									successToast="Shift scheduled"
									onsuccess={() => getStaffEventProduction(id).refresh()}
								>
									{#snippet form()}
										<!--
									The event is the one thing this form already knows, so it is
									locked rather than offered as a picker.
								-->
										<ShiftFormFields
											form={createShift}
											roles={liveVolunteerRoles}
											bind:roleId={shiftRoleId}
											lockedEvent={{ id: evt.id, title: evt.title }}
											startsAt={shiftStart}
											endsAt={shiftEnd}
											capacity={shiftCapacity}
										/>
									{/snippet}
								</Action>
							{/if}
						</div>
					</div>
				{/snippet}

				{#if advance.length > 0}
					<div class="mb-4">
						<h3 class="mb-2 text-sm font-semibold">Advance</h3>
						<ul class="flex flex-col gap-1 text-sm">
							{#each advance as order (order.id)}
								<li class="flex flex-wrap items-baseline justify-between gap-2">
									<a href={resolve(`/staff/volunteer/shifts/${order.id}`)} class="link font-medium">
										{order.roleName}
									</a>
									<span class="text-subtle whitespace-nowrap">
										{#if order.dueAt}
											due {formatDateShort(order.dueAt)}
										{:else}
											no deadline
										{/if}
									</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if shifts.length === 0 && advance.length === 0}
					<EmptyState
						title="No volunteer shifts"
						description="Nobody is scheduled to work this show yet."
					/>
				{:else if shifts.length > 0}
					<Table>
						{#snippet head()}
							<th>Role</th>
							<th class="whitespace-nowrap">When</th>
							<th class="cell-num">Confirmed</th>
						{/snippet}

						{#each shifts as shift (shift.id)}
							<tr class="hover">
								<td class="cell-primary">
									<a href={resolve(`/staff/volunteer/shifts/${shift.id}`)} class="link font-medium"
										>{shift.roleName}</a
									>
								</td>
								<td class="whitespace-nowrap">
									{formatDateShort(shift.startsAt)}, {formatTimeRange(shift.startsAt, shift.endsAt)}
								</td>
								<!--
								Confirmed, not "filled". Only a confirmed signup gets the day-before
								reminder and completes afterwards, so a show whose shifts are all
								claimed and none confirmed is not staffed
								(docs/reports/volunteer-workflow-findings.md#a3).
							-->
								<td class="cell-num whitespace-nowrap">
									<span class:text-warning={shift.confirmed < shift.capacity}>
										{shift.confirmed}/{shift.capacity}
									</span>
									{#if shift.claimed > shift.confirmed}
										<Badge variant="warning" size="xs" class="ml-1">
											+{shift.claimed - shift.confirmed}
										</Badge>
									{/if}
								</td>
							</tr>
						{/each}
					</Table>
				{/if}
			</InfoCard>
		</div>
	{/if}

	{#if visited.has('runOfShow')}
		<div
			role="tabpanel"
			aria-labelledby="tab-runOfShow"
			class="space-y-6"
			class:hidden={tab !== 'runOfShow'}
		>
			<fieldset disabled={productionLocked} class="contents">
				<RunOfShowPanel {runOfShow} eventId={id} showDate={productionDate} />
			</fieldset>
		</div>
	{/if}

	{#if visited.has('tickets')}
		<div
			role="tabpanel"
			aria-labelledby="tab-tickets"
			class="space-y-6"
			class:hidden={tab !== 'tickets'}
		>
			<ListingTicketing
				event={evt}
				ticketStats={data.ticketStats}
				ticketMoney={data.ticketMoney}
				tickets={data.tickets}
				onchange={refresh}
			/>
		</div>
	{/if}

	{#if visited.has('settlement')}
		<div
			role="tabpanel"
			aria-labelledby="tab-settlement"
			class="space-y-6"
			class:hidden={tab !== 'settlement'}
		>
			{#if budget}
				<ShowBudgetCard projectId={budget.projectId} burn={budget.burn} />
			{/if}
			<SettlementPanel {settlement} eventId={evt.id} />
		</div>
	{/if}
</PageContent>
