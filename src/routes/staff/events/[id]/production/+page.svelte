<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { getStaffEventProduction } from '#lib/remote/events.remote.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { formatDateTime, formatTime, fullDate, toLocalDate } from '#lib/utils/format.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { goto } from '$app/navigation';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import { listActInDirectory } from '#lib/remote/external-acts.remote.js';
	import { applyDutyList } from '#lib/remote/duty-lists.remote.js';
	import { toastWarnings } from '#lib/utils/toast-warnings.js';
	import {
		createProduction,
		updateProduction,
		setShowLead,
		searchShowLeadCandidates,
		openHostShift
	} from '#lib/remote/productions.remote.js';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import RelatedTasks from '#lib/components/task/RelatedTasks.svelte';
	import RelatedShifts from '#lib/components/volunteer/RelatedShifts.svelte';
	import ProductionStatusAction from './ProductionStatusAction.svelte';
	import { isTerminalProduction } from '#lib/production/status.js';
	import RunOfShowPanel from './RunOfShowPanel.svelte';
	import SettlementPanel from './SettlementPanel.svelte';
	import ShowBudgetCard from './ShowBudgetCard.svelte';
	import DeliverablesCard from './DeliverablesCard.svelte';
	import ArtifactRequestsPanel from './ArtifactRequestsPanel.svelte';
	import { TAB_KEYS, TAB_LABELS, parseTab, type TabKey } from './tabs';
	import { tabBadges } from './section-state';
	import { SvelteSet } from 'svelte/reactivity';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	let id = $derived(params.id);

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
	 */
	const loaded = $derived(await getStaffEventProduction(id));

	const dutyLists = $derived(loaded.dutyLists);
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

	const evt = $derived(loaded.detail.event);

	/**
	 * Only a show CMC produces has a production.
	 *
	 * Shifts, run of show and settlement mean nothing for a gig a member posted
	 * at someone else's venue. A hand-typed URL lands back on the listing at
	 * `/staff/events/[id]` rather than rendering an empty shell.
	 */
	$effect(() => {
		if (evt.source !== 'cmc') void goto(resolve(`staff/events/${id}`), { replace: true });
	});

	// ── Tabs ──────────────────────────────────────────────────────────────
	// Read out of the URL once, on mount, so a reload or a copied link lands on
	// the right panel. `tab` is the source of truth from then on.
	const initialTab = parseTab(page.url.searchParams.get('tab'));
	let tab = $state<TabKey>(initialTab);
	let tabBarEl = $state<HTMLElement | null>(null);

	// Keep-alive. A plain {#if} would unmount the Overview panel on tab change
	// and silently discard a half-typed production form — Form's `guard` only fires on
	// navigation, and switching tabs is not one.
	const visited = new SvelteSet<TabKey>([initialTab]);
	$effect(() => {
		visited.add(tab);
	});

	// Shallow, unlike the filter bars. A tab change is not a navigation, and
	// `FormGuard` hooks `beforeNavigate`: with the production form dirty, a real
	// navigation would be cancelled and pop "You have unsaved changes", whose
	// <dialog> then swallows pointer events for the whole page.
	$effect(() => {
		const href = withQuery(
			resolve(`staff/events/${id}/production`),
			tab === 'overview' ? '' : `tab=${tab}`
		);
		if (location.pathname + location.search !== href) {
			void goto(href, { shallow: true, replace: true });
		}
	});

	const badges = $derived(tabBadges(loaded));
	const tabs = $derived(
		TAB_KEYS.map((key) => ({ key, label: TAB_LABELS[key], badge: badges[key] }))
	);

	// ── Production form state ─────────────────────────────────────────────
	const productionFields = updateProduction.fields;
	const leadFields = setShowLead.fields;
	// The picker's pick, seeded with the saved lead whenever the record reloads.
	let leadId = $state('');
	let leadName = $state('');
	$effect(() => {
		leadId = productionRecord?.producerUserId ?? '';
		leadName = productionRecord?.producerName ?? '';
	});

	// One date for all five times: the listing already refuses to span two dates,
	// so five date fields would be five chances to disagree with each other.
	let productionDate = $state('');
	$effect(() => {
		if (!productionRecord) return;
		productionDate = toLocalDate(productionRecord.loadInAt ?? evt.startsAt);
	});
</script>

<!--
	Back-of-house only (#1946). The listing at `/staff/events/[id]` owns the
	lifecycle, the edit, the poster, the series, the room hold and the sale; this
	page owns the production record, the advance, the run of show and the money.
-->
<PageHeader
	width="3xl"
	title={evt.title}
	subtitle={m.staff_production_body()}
	crumb="Production"
	parent={{ label: evt.title, href: resolve('/staff/events/[id]', { id }) }}
>
	<Button href={resolve('/staff/events/[id]', { id })} variant="ghost"
		>{m.staff_events_id_production_view_listing_label()}</Button
	>
</PageHeader>
<PageContent width="3xl">
	<!-- When and where, read-only: the question the console is opened to answer
	     (#1068). Changing any of it is the listing's job. -->
	<p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted text-sm">
		<StatusBadge status={evt.status} />
		<span>{fullDate(evt.startsAt)}</span>
		<span>
			{#if evt.doorsAt}{m.staff_events_id_production_doors_text({
					formatTime: formatTime(evt.doorsAt)
				})}{/if}
			{m.staff_events_id_production_show_text({
				formatEventTimeRange: formatEventTimeRange(evt.startsAt, evt.endsAt)
			})}
		</span>
		<span
			>{evt.venueName ?? evt.location ?? m.staff_events_id_production_practice_space_text()}</span
		>
		{#if productionRecord?.producer}
			<span class="flex items-center gap-1" data-testid="event-lead">
				{m.staff_events_id_production_lead_text()}
				<EntityChip ref={productionRecord.producer} />
			</span>
		{/if}
	</p>

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
			<DeliverablesCard
				eventId={evt.id}
				items={loaded.deliverables}
				committees={loaded.deliverableCommittees}
			/>

			<!--
			The production record: the ops half of the night, opened from the event
			page and worked on here. Null until somebody opens one — a listing on the
			guide is not a production, and most of them never become one.
		-->
			{#if productionRecord}
				<InfoCard title={m.staff_production_title()} testid="production-record">
					{#snippet header(title)}
						<div class="flex flex-wrap items-center justify-between gap-2">
							<CardTitle>{title}</CardTitle>
							<div class="flex items-center gap-2">
								<StatusBadge status={productionRecord.status} label />
								<ProductionStatusAction production={productionRecord} eventId={evt.id} />
							</div>
						</div>
					{/snippet}

					{#if productionRecord.closedAt}
						<!-- `updatedAt` is not this date: it moves on any later write. -->
						<p class="text-muted text-sm">
							{productionRecord.closedByName
								? m.staff_events_id_production_closed_by_text({
										date: formatDateTime(productionRecord.closedAt),
										name: productionRecord.closedByName
									})
								: m.staff_events_id_production_closed_text({
										date: formatDateTime(productionRecord.closedAt)
									})}
						</p>
					{/if}
					{#if productionLocked}
						<p class="text-muted text-sm">
							{m.staff_events_id_production_show_so_read_only_text({
								status: productionRecord.status
							})}
						</p>
					{/if}
					<!-- A terminal show is the past. Disabled here for clarity; the server refuses
					     the writes either way. -->
					<fieldset disabled={productionLocked} class="contents">
						<!-- One named person, appointed by booking, who then runs the show
						     through `production.run` (#2726). Its own form: naming a lead
						     should not wait on the Save below. -->
						<div class="flex flex-col gap-2">
							<span class="text-muted">{m.staff_events_id_production_lead_text()}</span>
							{#if loaded.canSetLead}
								<Form
									remote={setShowLead}
									successToast={m.staff_events_id_production_lead_saved_toast()}
									class="flex flex-col gap-2"
								>
									<input {...leadFields.id.as('hidden', productionRecord.id)} />
									<input {...leadFields.eventId.as('hidden', evt.id)} />
									<MemberPicker
										field={leadFields.leadUserId}
										label={m.staff_events_id_production_lead_label()}
										placeholder={m.staff_events_id_production_lead_search_placeholder()}
										search={(q) => searchShowLeadCandidates({ eventId: evt.id, q })}
										bind:value={leadId}
										bind:name={leadName}
									/>
									{#if leadId !== (productionRecord.producerUserId ?? '')}
										<SubmitButton
											label={m.staff_events_id_production_lead_save_label()}
											size="sm"
										/>
									{/if}
								</Form>
							{:else if productionRecord.producer}
								<EntityChip ref={productionRecord.producer} />
							{:else}
								<span class="font-medium">{m.staff_events_id_production_no_lead_text()}</span>
							{/if}
						</div>

						<!-- Who runs the night, which is not always who booked it. A shift
					     rather than a field: the producer opens it, and a host claims
					     it through the same pipeline as any other volunteer, so the
					     handover carries confirmation and hours with it (#932). -->
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-muted">{m.staff_events_id_production_host_text()}</span>
							{#if hostShift && hostShift.hosts.length > 0}
								{#each hostShift.hosts as host (host.userId)}
									<span class="font-medium">{host.name}</span>
									<StatusBadge status={host.status} />
								{/each}
							{:else if hostShift}
								<span class="font-medium"
									>{m.staff_events_id_production_shift_open_nobody_text()}</span
								>
								<a class="link text-sm" href={resolve(`staff/tasks/${hostShift.workOrderId}`)}>
									{m.staff_events_id_production_find_somebody_text()}
								</a>
							{:else}
								<!-- Names the host, so it never reads as the event lead's line. -->
								<span class="font-medium">{m.staff_events_id_production_no_host_yet_text()}</span>
								<Form
									remote={openHostShift}
									successToast={m.staff_events_id_production_host_shift_opened_toast()}
								>
									<input {...openHostShift.fields.eventId.as('hidden', evt.id)} />
									<SubmitButton
										label={m.staff_events_id_production_open_host_shift_label()}
										variant="ghost"
										size="xs"
									/>
								</Form>
							{/if}
						</div>

						<Form
							remote={updateProduction}
							guard
							successToast={m.staff_events_id_production_production_updated_toast()}
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
								label={m.staff_events_id_production_show_date_label()}
								bind:value={productionDate}
							/>
							<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								<FormField
									field={productionFields.loadInTime}
									type="time"
									label={m.staff_events_id_production_load_label()}
								/>
								<FormField
									field={productionFields.soundcheckTime}
									type="time"
									label={m.staff_soundcheck_label()}
								/>
								<FormField
									field={productionFields.firstSetTime}
									type="time"
									label={m.staff_events_id_production_first_set_label()}
								/>
								<FormField
									field={productionFields.curfewTime}
									type="time"
									label={m.staff_events_id_production_curfew_label()}
								/>
								<FormField
									field={productionFields.loadOutTime}
									type="time"
									label={m.staff_events_id_production_load_out_by_label()}
								/>
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
								label={m.staff_events_id_production_bands_wanted_label()}
								value={productionRecord.actsWanted?.toString() ?? ''}
								options={[
									{ value: '', label: m.staff_events_id_production_no_target_set_label() },
									...Array.from({ length: 8 }, (_, i) => ({
										value: String(i + 1),
										label: `${i + 1} ${i === 0 ? 'band' : 'bands'}`
									}))
								]}
								description={m.staff_events_id_production_how_many_bill_should_end_body()}
							/>

							<FormField
								field={productionFields.billingNotes}
								label={m.staff_events_id_production_billing_label()}
								description={m.staff_events_id_production_what_bands_were_told_about_body()}
							/>
							<FormField
								field={productionFields.hospitalityNotes}
								label={m.staff_hospitality_label()}
								description={m.staff_events_id_production_green_room_food_parking_what_body()}
							/>
							<FormField
								field={productionFields.internalNotes}
								label={m.staff_events_id_production_internal_notes_label()}
								description={m.staff_events_id_production_staff_only_never_shown_band_body()}
							/>

							<SubmitButton label={m.staff_events_id_production_save_production_label()} />
						</Form>
					</fieldset>
				</InfoCard>
			{:else}
				<!-- The page that explains the thing is the page that makes it. This
				     used to point back at the event page, so a first-timer who came
				     here was sent where they had just been, with nothing on screen
				     naming the button (#976). -->
				<InfoCard
					title={m.staff_production_title()}
					state={m.staff_production_state_not_opened_label()}
				>
					<p class="text-muted">
						{m.staff_events_id_production_no_production_record_yet_open_text()}
					</p>
					<Form remote={createProduction} class="mt-3">
						<input {...createProduction.fields.eventId.as('hidden', id)} />
						<SubmitButton
							label={m.staff_events_id_production_open_production_label()}
							variant="primary"
							size="sm"
						/>
					</Form>
				</InfoCard>
			{/if}
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
				<InfoCard title={m.staff_events_id_production_tech_riders_title()}>
					{#snippet header(title)}
						<div class="flex items-center justify-between gap-2">
							<CardTitle>{title}</CardTitle>
							{#if ridersMissing > 0}
								<Badge variant="warning"
									>{m.staff_events_id_production_not_yet_label({ ridersMissing })}</Badge
								>
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
										<span class="text-sm text-base-content/60"
											>{m.staff_events_id_production_nothing_sent_yet_text()}</span
										>
									{:else}
										<span class="text-sm text-base-content/60"
											>{m.staff_events_id_production_not_directory_yet_text()}</span
										>
										<Action
											action={listActInDirectory.for(act.id)}
											label={m.staff_events_id_production_add_directory_label()}
											variant="ghost"
											size="xs"
											modalTitle={m.staff_events_id_production_add_directory_2_title({
												name: act.name
											})}
											submitLabel={m.staff_events_id_production_add_directory_label()}
											successToast={m.staff_events_id_production_can_asked_now_toast({
												name: act.name
											})}
											onsuccess={() => getStaffEventProduction(id).refresh()}
										>
											{#snippet form()}
												<input {...listActInDirectory.fields.eventBandId.as('hidden', act.id)} />
												<p class="text-sm">
													<ParaglideMessage
														message={m.staff_events_id_production_records_as_external_act_no_text}
														inputs={{ name: act.name }}
														>{#snippet strong({ children })}<strong>{@render children?.()}</strong
															>{/snippet}</ParaglideMessage
													>
												</p>
											{/snippet}
										</Action>
									{/if}
								{:else}
									{#if act.channelCount > 0}
										<Badge
											>{m.staff_events_id_production_ch_label({
												channelCount: act.channelCount
											})}</Badge
										>
									{/if}
									{#if act.phantomCount > 0}
										<Badge
											>{m.staff_events_id_production_48v_label({
												phantomCount: act.phantomCount
											})}</Badge
										>
									{/if}
									{#if act.venueProvidedCount > 0}
										<Badge variant="info"
											>{m.staff_events_id_production_from_us_label({
												venueProvidedCount: act.venueProvidedCount
											})}</Badge
										>
									{/if}
									{#if act.uploadCount > 0}
										<Badge variant="ghost"
											>{m.staff_events_id_production_files_label({
												uploadCount: act.uploadCount
											})}</Badge
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
											{m.staff_events_id_production_rider_label()}
										</Button>
										<Button
											href={resolve('/band/[slug]/packing', { slug: act.slug })}
											variant="ghost"
											size="sm"
										>
											{m.staff_events_id_production_packing_label()}
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
							{m.staff_events_id_production_input_list_whole_bill_label()}
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
			<RelatedTasks subject={{ type: 'event', id: evt.id }} />

			<RelatedShifts subject={{ type: 'event', id: evt.id }}>
				{#snippet actions(refresh)}
					{#if dutyLists.length > 0}
						<Action
							action={applyDutyList}
							label={m.staff_apply_template_label()}
							variant="ghost"
							size="sm"
							modalTitle={m.staff_events_id_production_apply_template_title({
								title: evt.title
							})}
							submitLabel={m.staff_apply_label()}
							successToast={m.staff_events_id_production_work_orders_created_toast()}
							onsuccess={(r) => {
								toastWarnings(r);
								refresh();
								void getStaffEventProduction(id).refresh();
							}}
						>
							{#snippet form()}
								<input {...applyDutyList.fields.eventId.as('hidden', evt.id)} />
								<FormField
									field={applyDutyList.fields.dutyListId}
									label={m.staff_template_label()}
									type="select"
									options={dutyLists.map((l) => ({ value: l.id, label: l.name }))}
								/>
								<FormField
									field={applyDutyList.fields.reason}
									label={m.staff_reason_if_applying_again_label()}
									type="text"
								/>
							{/snippet}
						</Action>
					{/if}
				{/snippet}
			</RelatedShifts>
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
				<RunOfShowPanel
					{runOfShow}
					actContacts={loaded.actContacts}
					eventId={id}
					showDate={productionDate}
				/>
			</fieldset>
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
