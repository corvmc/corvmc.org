<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { resolve } from '$app/paths';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { getStaffEventProduction } from '#lib/remote/events.remote.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { formatDateTime } from '#lib/utils/format.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import { listActInDirectory } from '#lib/remote/external-acts.remote.js';
	import { applyDutyList } from '#lib/remote/duty-lists.remote.js';
	import { toastWarnings } from '#lib/utils/toast-warnings.js';
	import { createProduction, updateProduction } from '#lib/remote/productions.remote.js';
	import RelatedTasks from '#lib/components/task/RelatedTasks.svelte';
	import RelatedShifts from '#lib/components/volunteer/RelatedShifts.svelte';
	import ProductionStatusAction from './ProductionStatusAction.svelte';
	import { isTerminalProduction } from '#lib/production/status.js';
	import LineupPanel from './LineupPanel.svelte';
	import RunOfShowPanel from './RunOfShowPanel.svelte';
	import SettlementPanel from './SettlementPanel.svelte';
	import ShowBudgetCard from './ShowBudgetCard.svelte';
	import DeliverablesCard from './DeliverablesCard.svelte';
	import ArtifactRequestsPanel from './ArtifactRequestsPanel.svelte';
	import RiderStockPanel from './RiderStockPanel.svelte';

	/**
	 * The Production tab of a CMC show (#3270): the production record, the
	 * advance, the run of show and the money, stacked. Loaded only when the tab
	 * opens, so the listing's first paint never waits on it.
	 */
	let { eventId }: { eventId: string } = $props();
	const id = $derived(eventId);

	const loaded = $derived(await getStaffEventProduction(id));

	const dutyLists = $derived(loaded.dutyLists);
	const riders = $derived(loaded.riders);
	const productionRecord = $derived(loaded.production);
	const productionLocked = $derived(
		productionRecord ? isTerminalProduction(productionRecord.status) : false
	);
	const runOfShow = $derived(loaded.runOfShow);
	const settlement = $derived(loaded.settlement);
	const budget = $derived(loaded.budget);
	/** The advance question: who has told us nothing at all. */
	const ridersMissing = $derived(riders.filter((r) => r.empty).length);

	const evt = $derived(loaded.detail.event);

	// The section renders after the query, past the browser's own hash scroll.
	$effect(() => {
		if (settlement && page.url.hash === '#settlement') {
			document.getElementById('settlement')?.scrollIntoView();
		}
	});

	const productionFields = updateProduction.fields;
</script>

<div class="flex flex-col gap-6">
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
		<InfoCard title={m.staff_production_title()}>
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
				<Form
					remote={updateProduction}
					guard
					successToast={m.staff_events_id_production_production_updated_toast()}
				>
					<input {...productionFields.id.as('hidden', productionRecord.id)} />
					<input {...productionFields.eventId.as('hidden', evt.id)} />
					<FormField
						field={productionFields.internalNotes}
						label={m.staff_events_id_production_internal_notes_label()}
						value={productionRecord.internalNotes ?? ''}
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

	{#if productionRecord && runOfShow}
		<fieldset disabled={productionLocked} class="contents">
			<LineupPanel
				eventId={id}
				production={productionRecord}
				{runOfShow}
				{riders}
				canBook={loaded.canBook}
			/>
			<RunOfShowPanel
				{runOfShow}
				production={productionRecord}
				doorsAt={evt.doorsAt ?? null}
				eventId={id}
			/>
		</fieldset>
	{/if}

	<ArtifactRequestsPanel
		eventId={evt.id}
		eventTitle={evt.title}
		requests={loaded.artifactRequests}
		acts={loaded.requestableActs}
		onchange={() => getStaffEventProduction(id).refresh()}
	/>

	<!--
		Rendered whenever there is a bill, even when no act has sent a rider: hiding
		it would make "nobody has sent a rider" look the same as "this page does not
		track riders".
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
								{#if loaded.canBook}
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
		<RiderStockPanel
			eventId={evt.id}
			check={loaded.riderStock}
			onchange={() => getStaffEventProduction(id).refresh()}
		/>
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

	{#if budget}
		<ShowBudgetCard projectId={budget.projectId} burn={budget.burn} />
	{/if}
	{#if settlement}
		<section id="settlement" class="flex flex-col gap-6" data-testid="settlement">
			<SettlementPanel {settlement} eventId={evt.id} />
		</section>
	{/if}
</div>
