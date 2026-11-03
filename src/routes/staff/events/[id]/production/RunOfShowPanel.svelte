<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import SendContactSheetAction from '$lib/components/actions/SendContactSheetAction.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import Field from '$lib/components/ui/Form/FormField.svelte';
	import MoneyField from '$lib/components/ui/Form/MoneyField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { formatTime, toLocalTime } from '$lib/utils/format';
	import { IconArrowUp, IconArrowDown, IconTrash } from '@tabler/icons-svelte';
	import {
		addRunOfShowSlot,
		updateRunOfShowSlot,
		moveRunOfShowSlot,
		removeRunOfShowSlot,
		setRunOfShowTerms,
		buildRunOfShowFromLineup,
		markSlotTiming
	} from '$lib/remote/productions.remote';
	import { describeTerms } from '$lib/production/terms';
	import type { RunOfShow } from '$lib/types/run-of-show';

	/**
	 * How late this set actually started, in whole minutes. Positive is behind.
	 *
	 * Null when there is nothing to compare — a slot with no schedule, or one
	 * nobody has started. The host reads this number to decide whether a long
	 * changeover is a problem, which it could only ever be asserted before
	 * `actualStartAt` existed (#928).
	 */
	function driftMinutes(slot: RunOfShow['slots'][number]): number | null {
		if (!slot.actualStartAt || !slot.scheduledStartAt) return null;
		return Math.round((slot.actualStartAt.getTime() - slot.scheduledStartAt.getTime()) / 60_000);
	}

	/**
	 * The running order, as a producer works it.
	 *
	 * Its own component rather than a fifth panel inline: the page is already
	 * long, and every row here carries three forms of its own.
	 */
	let {
		runOfShow,
		eventId,
		showDate
	}: {
		runOfShow: RunOfShow | null;
		eventId: string;
		/** The night's date, shared by every time field — see the Overview form. */
		showDate: string;
	} = $props();

	// One disclosure open at a time. Every mounted row's forms stay in the DOM
	// for the life of the page, so twelve open detail forms is twelve times the
	// DOM nobody is looking at.
	let openSlotId = $state<string | null>(null);

	const addFields = addRunOfShowSlot.fields;

	const actOptions = $derived([
		{ value: '', label: m.staff_events_id_production_run_of_show_panel_not_bill_dj_hos() },
		...(runOfShow?.unslotted ?? []).map((act) => ({ value: act.eventBandId, label: act.name }))
	]);

	function warningsFor(slotId: string) {
		return (runOfShow?.warnings ?? []).filter((w) => w.slotId === slotId);
	}

	const showWarnings = $derived((runOfShow?.warnings ?? []).filter((w) => w.slotId === null));
</script>

{#if !runOfShow}
	<EmptyState
		title={m.staff_events_id_production_run_of_show_panel_no_production_y()}
		description={m.staff_events_id_production_run_of_show_panel_open_one_overvi()}
	/>
{:else}
	<InfoCard title={m.staff_night()}>
		<div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
			<span>
				First set
				<strong class="tabular-nums">
					{runOfShow.firstSetAt ? formatTime(runOfShow.firstSetAt) : 'not set'}
				</strong>
			</span>
			<span>
				Curfew
				<strong class="tabular-nums">
					{runOfShow.curfewAt ? formatTime(runOfShow.curfewAt) : 'not set'}
				</strong>
			</span>
		</div>
	</InfoCard>

	{#if !runOfShow.firstSetAt}
		<!--
			Without a downbeat every set time is null, and a column of blanks reads
			as a bug rather than as a question nobody has answered yet.
		-->
		<Alert type="warning">
			{m.staff_events_id_production_run_of_show_panel_set_first_set_t()}
		</Alert>
	{/if}

	{#each showWarnings as warning (warning.code)}
		<Alert type="warning">{warning.message}</Alert>
	{/each}

	{#if runOfShow.slots.length === 0}
		<EmptyState
			title={m.staff_events_id_production_run_of_show_panel_nothing_stage_y()}
			description={m.staff_events_id_production_run_of_show_panel_build_running_o()}
		>
			<Form
				remote={buildRunOfShowFromLineup}
				successToast={m.staff_events_id_production_run_of_show_panel_running_order_b()}
			>
				<input {...buildRunOfShowFromLineup.fields.eventId.as('hidden', eventId)} />
				<input
					{...buildRunOfShowFromLineup.fields.productionId.as('hidden', runOfShow.productionId)}
				/>
				<SubmitButton label={m.staff_events_id_production_run_of_show_panel_build_from_bill()} />
			</Form>
		</EmptyState>
	{:else}
		<ul class="divide-y divide-base-300 rounded-box border border-base-300">
			{#each runOfShow.slots as slot, i (slot.id)}
				{@const up = moveRunOfShowSlot.for(`${slot.id}:up`)}
				{@const down = moveRunOfShowSlot.for(`${slot.id}:down`)}
				{@const edit = updateRunOfShowSlot.for(slot.id)}
				{@const drop = removeRunOfShowSlot.for(slot.id)}
				{@const clock = markSlotTiming.for(slot.id)}
				{@const undo = markSlotTiming.for(`${slot.id}:clear`)}
				{@const drift = driftMinutes(slot)}
				<li class="p-3">
					<div class="flex flex-wrap items-center gap-3">
						<div class="w-36 shrink-0 tabular-nums">
							{#if slot.scheduledStartAt && slot.scheduledEndAt}
								{formatTime(slot.scheduledStartAt)} – {formatTime(slot.scheduledEndAt)}
							{:else}
								<span class="text-subtle">—</span>
							{/if}
							<!-- What it actually ran to, under what it was meant to. Drift is
							     the number the host is reading, so it is the loud part. -->
							{#if slot.actualStartAt}
								<div class="text-sm">
									{formatTime(slot.actualStartAt)}{#if slot.actualEndAt}&nbsp;– {formatTime(
											slot.actualEndAt
										)}{/if}
									{#if drift !== null}
										<span class:text-error={drift > 0} class:text-success={drift <= 0}>
											{m.staff_events_id_production_run_of_show_panel_m({
												value: drift > 0 ? `+${drift}` : drift
											})}
										</span>
									{/if}
								</div>
							{/if}
						</div>

						<div class="min-w-0 grow">
							<div class="flex items-center gap-2">
								<span class="truncate font-medium">{slot.actName ?? 'Not on the bill'}</span>
								{#if slot.actStatus}
									<StatusBadge status={slot.actStatus} />
								{/if}
							</div>
							<div class="text-subtle">
								{m.staff_events_id_production_run_of_show_panel_min_set_min_cha({
									setLengthMinutes: slot.setLengthMinutes,
									changeoverMinutes: slot.changeoverMinutes
								})}
								{#if slot.soundcheckAt}
									{m.staff_events_id_production_run_of_show_panel_soundcheck({
										formatTime: formatTime(slot.soundcheckAt)
									})}
								{/if}
							</div>
							{#if slot.eventBandId}
								<!-- The deal reads on the row, not only inside the editor: the
								     number the act will question is the one worth showing. -->
								<div class="text-subtle">{describeTerms(slot.terms)}</div>
							{/if}
						</div>

						<!-- Started and Finished, and a way back from a mistap. The server
						     stamps the time: a tab left open since load-in would otherwise
						     write a moment that has long passed (#928). -->
						<div class="flex w-max shrink-0 items-center gap-1">
							<!-- Gone once the set has ended rather than disabled: a dead
							     button on every finished row is three quarters of the
							     running order by the end of the night. Undo is the way back. -->
							{#if !slot.actualEndAt}
								<Form
									remote={clock}
									successToast={m.staff_events_id_production_run_of_show_panel_noted()}
								>
									<input {...clock.fields.slotId.as('hidden', slot.id)} />
									<input {...clock.fields.eventId.as('hidden', eventId)} />
									<input
										{...clock.fields.edge.as('hidden', slot.actualStartAt ? 'end' : 'start')}
									/>
									<input {...clock.fields.action.as('hidden', 'now')} />
									<SubmitButton
										label={slot.actualStartAt ? m.staff_finished() : m.staff_started()}
										variant={slot.actualStartAt ? 'default' : 'primary'}
										size="xs"
									/>
								</Form>
							{/if}
							{#if slot.actualStartAt}
								<Form remote={undo} successToast={m.staff_cleared()}>
									<input {...undo.fields.slotId.as('hidden', slot.id)} />
									<input {...undo.fields.eventId.as('hidden', eventId)} />
									<input {...undo.fields.edge.as('hidden', slot.actualEndAt ? 'end' : 'start')} />
									<input {...undo.fields.action.as('hidden', 'clear')} />
									<SubmitButton label={m.staff_undo()} variant="ghost" size="xs" />
								</Form>
							{/if}
						</div>

						<div class="flex shrink-0 items-center gap-1">
							<!--
				Two form instances per row, keyed apart: one `<Form>` is one `<form>`,
				and both directions posting through the same instance would share a
				pending state.
			-->
							<Form remote={up} class="contents">
								<input {...up.fields.eventId.as('hidden', eventId)} />
								<input {...up.fields.slotId.as('hidden', slot.id)} />
								<input {...up.fields.direction.as('hidden', 'up')} />
								<SubmitButton
									label={m.staff_events_id_production_run_of_show_panel_up()}
									variant="ghost"
									size="sm"
									icon={upIcon}
									disabled={i === 0}
								/>
							</Form>
							<Form remote={down} class="contents">
								<input {...down.fields.eventId.as('hidden', eventId)} />
								<input {...down.fields.slotId.as('hidden', slot.id)} />
								<input {...down.fields.direction.as('hidden', 'down')} />
								<SubmitButton
									label={m.staff_events_id_production_run_of_show_panel_down()}
									variant="ghost"
									size="sm"
									icon={downIcon}
									disabled={i === runOfShow.slots.length - 1}
								/>
							</Form>
							<Button
								variant="ghost"
								size="sm"
								onclick={() => (openSlotId = openSlotId === slot.id ? null : slot.id)}
							>
								{openSlotId === slot.id ? 'Close' : 'Edit'}
							</Button>
							<Action
								action={drop}
								label={m.staff_remove()}
								iconOnly
								icon={trashIcon}
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle={m.staff_events_id_production_run_of_show_panel_modal_title()}
								submitLabel={m.staff_remove()}
								submitVariant="error"
								successToast={m.staff_events_id_production_run_of_show_panel_set_removed()}
							>
								{#snippet form()}
									<input {...drop.fields.eventId.as('hidden', eventId)} />
									<input {...drop.fields.slotId.as('hidden', slot.id)} />
									<p class="text-sm">
										{slot.actName ?? 'This set'} comes off the running order. Every set after it moves
										up.
									</p>
								{/snippet}
							</Action>
						</div>
					</div>

					{#each warningsFor(slot.id) as warning (warning.code)}
						<div class="mt-2"><Alert type="warning">{warning.message}</Alert></div>
					{/each}

					{#if openSlotId === slot.id}
						<Form remote={edit} guard successToast={m.staff_saved()} class="mt-3 space-y-4">
							<input {...edit.fields.eventId.as('hidden', eventId)} />
							<input {...edit.fields.slotId.as('hidden', slot.id)} />
							<input {...edit.fields.soundcheckDate.as('hidden', showDate)} />
							<div class="grid gap-4 md:grid-cols-3">
								<Field
									field={edit.fields.setLengthMinutes}
									type="number"
									label={m.staff_events_id_production_run_of_show_panel_set_length_minu()}
									value={slot.setLengthMinutes}
								/>
								<Field
									field={edit.fields.changeoverMinutes}
									type="number"
									label={m.staff_events_id_production_run_of_show_panel_changeover_afte()}
									value={slot.changeoverMinutes}
								/>
								<Field
									field={edit.fields.soundcheckTime}
									type="time"
									label={m.staff_soundcheck()}
									value={slot.soundcheckAt ? toLocalTime(slot.soundcheckAt) : ''}
									description={m.staff_events_id_production_run_of_show_panel_not_part_schedu()}
								/>
							</div>
							<Field
								field={edit.fields.techNotes}
								type="textarea"
								label={m.staff_events_id_production_run_of_show_panel_tech_notes()}
								value={slot.techNotes ?? ''}
							/>
							<Field
								field={edit.fields.backlineNeeds}
								type="textarea"
								label={m.staff_events_id_production_run_of_show_panel_backline()}
								value={slot.backlineNeeds ?? ''}
							/>
							<Field
								field={edit.fields.hospitalityNotes}
								type="textarea"
								label={m.staff_hospitality()}
								value={slot.hospitalityNotes ?? ''}
							/>
							<div class="grid gap-4 md:grid-cols-3">
								<Field
									field={edit.fields.contactName}
									label={m.staff_events_id_production_run_of_show_panel_contact_show()}
									value={slot.contactName ?? ''}
									description={m.staff_events_id_production_run_of_show_panel_tour_manager_wh()}
								/>
								<Field
									field={edit.fields.contactEmail}
									type="email"
									label={m.staff_email()}
									value={slot.contactEmail ?? ''}
								/>
								<Field
									field={edit.fields.contactPhone}
									type="tel"
									label={m.staff_phone()}
									value={slot.contactPhone ?? ''}
								/>
							</div>
							<div class="flex items-center justify-between gap-3">
								{#if slot.actEntryId}
									<!-- The act fills its own details in rather than a staffer typing
									     them: `/act/[token]` is the privacy-best path, and CMC then
									     holds what the act chose to give. -->
									<SendContactSheetAction
										entryId={slot.actEntryId}
										actName={slot.actName}
										defaultEmail={slot.contactEmail ?? ''}
									/>
								{:else}
									<span></span>
								{/if}
								<SubmitButton label={m.staff_save()} />
							</div>
						</Form>

						{#if slot.eventBandId}
							{@const terms = setRunOfShowTerms.for(slot.id)}
							<!--
								A separate form from the one above. What an act is credited and
								what an act is paid are different questions, edited by different
								people, and a settlement capability would guard one of them.
							-->
							<Form
								remote={terms}
								guard
								successToast={m.staff_events_id_production_run_of_show_panel_terms_saved()}
								class="mt-4 space-y-4"
							>
								<input {...terms.fields.eventId.as('hidden', eventId)} />
								<input {...terms.fields.slotId.as('hidden', slot.id)} />
								<h3 class="text-sm font-semibold">
									{m.staff_events_id_production_run_of_show_panel_deal()}
								</h3>
								<div class="grid gap-4 md:grid-cols-2">
									<MoneyField
										field={terms.fields.guaranteeCents}
										label={m.staff_events_id_production_run_of_show_panel_guarantee()}
										value={slot.terms.guaranteeCents}
										description={m.staff_events_id_production_run_of_show_panel_leave_empty_no()}
									/>
									<Field
										field={terms.fields.percentageBps}
										type="number"
										label={m.staff_events_id_production_run_of_show_panel_percentage_basi()}
										value={slot.terms.percentageBps ?? undefined}
										description={m.staff_events_id_production_run_of_show_panel_7000_70()}
									/>
								</div>
								<Field
									field={terms.fields.versus}
									type="checkbox"
									label={m.staff_events_id_production_run_of_show_panel_versus()}
									checkboxLabel={m.staff_events_id_production_run_of_show_panel_pay_guarantee_p()}
									value={slot.terms.versus}
								/>
								<Field
									field={terms.fields.againstNet}
									type="checkbox"
									label={m.staff_events_id_production_run_of_show_panel_against_net()}
									checkboxLabel={m.staff_events_id_production_run_of_show_panel_percentage_net()}
									value={slot.terms.againstNet}
								/>
								<Field
									field={terms.fields.contributed}
									type="checkbox"
									label={m.staff_events_id_production_run_of_show_panel_donated()}
									checkboxLabel={m.staff_events_id_production_run_of_show_panel_played_free_rec()}
									value={slot.terms.contributed}
								/>
								<div class="flex items-center justify-between gap-3">
									<span class="text-subtle">{describeTerms(slot.terms)}</span>
									<SubmitButton
										label={m.staff_events_id_production_run_of_show_panel_save_terms()}
									/>
								</div>
							</Form>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<InfoCard title={m.staff_events_id_production_run_of_show_panel_add_set()}>
		<Form
			remote={addRunOfShowSlot}
			successToast={m.staff_events_id_production_run_of_show_panel_set_added()}
			class="space-y-4"
		>
			<input {...addFields.eventId.as('hidden', eventId)} />
			<input {...addFields.productionId.as('hidden', runOfShow.productionId)} />
			<div class="grid gap-4 md:grid-cols-3">
				<Field
					field={addFields.eventBandId}
					type="select"
					label={m.staff_band()}
					options={actOptions}
				/>
				<Field
					field={addFields.setLengthMinutes}
					type="number"
					label={m.staff_events_id_production_run_of_show_panel_set_length_minu()}
					value={30}
				/>
				<Field
					field={addFields.changeoverMinutes}
					type="number"
					label={m.staff_events_id_production_run_of_show_panel_changeover_afte()}
					value={10}
				/>
			</div>
			<div class="flex justify-end"><SubmitButton label={m.staff_add()} /></div>
		</Form>
		{#if runOfShow.unslotted.length > 0}
			<p class="mt-2 text-subtle">
				{m.staff_events_id_production_run_of_show_panel_still_off_runni({
					join: runOfShow.unslotted.map((a) => a.name).join(', ')
				})}
			</p>
		{:else if runOfShow.slots.length > 0}
			<p class="mt-2 text-subtle">
				{m.staff_events_id_production_run_of_show_panel_every_band_bill()}
			</p>
		{/if}
	</InfoCard>
{/if}

{#snippet upIcon()}
	<IconArrowUp size={16} />
{/snippet}
{#snippet downIcon()}
	<IconArrowDown size={16} />
{/snippet}
{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}
