<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { formatTime, toLocalTime } from '#lib/utils/format.js';
	import {
		markRunOfShowDone,
		markSlotTiming,
		setRunOfShowTime,
		updateProduction
	} from '#lib/remote/productions.remote.js';
	import { runningOrderState } from './section-state';
	import type { RunOfShow } from '#lib/types/run-of-show.js';

	/**
	 * The show's clock, row by row (#3272): load-in, soundcheck, doors, the sets,
	 * curfew and load-out, each `[time] · label · Done`. Doors is the listing's
	 * and read-only here; the first set's time is the one a producer sets, and
	 * every later set follows from the play order, set lengths and changeover.
	 */
	let {
		runOfShow,
		production,
		doorsAt,
		eventId
	}: {
		runOfShow: RunOfShow;
		production: {
			id: string;
			loadInAt: Date | null;
			soundcheckAt: Date | null;
			curfewAt: Date | null;
			loadOutBy: Date | null;
			loadInDoneAt: Date | null;
			soundcheckDoneAt: Date | null;
			doorsDoneAt: Date | null;
			curfewDoneAt: Date | null;
			loadOutDoneAt: Date | null;
		};
		doorsAt: Date | null;
		eventId: string;
	} = $props();

	type FixedRow = 'loadIn' | 'soundcheck' | 'doors' | 'curfew' | 'loadOut';

	const beforeSets: FixedRow[] = ['loadIn', 'soundcheck', 'doors'];
	const afterSets: FixedRow[] = ['curfew', 'loadOut'];

	const fixed = $derived<Record<FixedRow, { at: Date | null; doneAt: Date | null }>>({
		loadIn: { at: production.loadInAt, doneAt: production.loadInDoneAt },
		soundcheck: { at: production.soundcheckAt, doneAt: production.soundcheckDoneAt },
		doors: { at: doorsAt, doneAt: production.doorsDoneAt },
		curfew: { at: production.curfewAt, doneAt: production.curfewDoneAt },
		loadOut: { at: production.loadOutBy, doneAt: production.loadOutDoneAt }
	});

	const labels: Record<FixedRow, () => string> = {
		loadIn: () => m.staff_events_id_production_load_label(),
		soundcheck: () => m.staff_soundcheck_label(),
		doors: () => m.staff_events_id_production_run_of_show_doors_label(),
		curfew: () => m.staff_events_id_production_curfew_label(),
		loadOut: () => m.staff_events_id_production_load_out_by_label()
	};

	function submitOnChange(e: Event) {
		(e.currentTarget as HTMLInputElement).form?.requestSubmit();
	}

	const showWarnings = $derived(runOfShow.warnings.filter((w) => w.slotId === null));
	const changeoverFields = updateProduction.fields;
</script>

{#snippet timeField(
	row: 'loadIn' | 'soundcheck' | 'firstSet' | 'curfew' | 'loadOut',
	at: Date | null
)}
	{@const edit = setRunOfShowTime.for(row)}
	<Form remote={edit} class="contents" guard={false}>
		<input {...edit.fields.id.as('hidden', production.id)} />
		<input {...edit.fields.eventId.as('hidden', eventId)} />
		<input {...edit.fields.row.as('hidden', row)} />
		<FormField
			field={edit.fields.time}
			type="time"
			aria-label={row === 'firstSet'
				? m.staff_events_id_production_first_set_label()
				: labels[row]()}
			value={at ? toLocalTime(at) : ''}
			onchange={submitOnChange}
		/>
	</Form>
{/snippet}

{#snippet doneButton(row: FixedRow, doneAt: Date | null)}
	{@const mark = markRunOfShowDone.for(`${row}:${doneAt ? 'clear' : 'now'}`)}
	<Form remote={mark} class="contents" guard={false}>
		<input {...mark.fields.id.as('hidden', production.id)} />
		<input {...mark.fields.eventId.as('hidden', eventId)} />
		<input {...mark.fields.row.as('hidden', row)} />
		<input {...mark.fields.action.as('hidden', doneAt ? 'clear' : 'now')} />
		{@render doneControl(doneAt)}
	</Form>
{/snippet}

{#snippet doneControl(doneAt: Date | null)}
	{#if doneAt}
		<span class="text-sm tabular-nums">{formatTime(doneAt)}</span>
		<SubmitButton label={m.staff_undo_label()} variant="ghost" size="xs" />
	{:else}
		<SubmitButton label={m.staff_done_label()} variant="default" size="xs" />
	{/if}
{/snippet}

<InfoCard
	title={m.staff_events_id_production_run_of_show_panel_run_of_show_title()}
	state={runningOrderState(runOfShow)}
	testid="run-of-show"
>
	{#if !runOfShow.firstSetAt}
		<Alert type="warning">
			{m.staff_events_id_production_run_of_show_panel_set_first_set_t_body()}
		</Alert>
	{/if}
	{#each showWarnings as warning (warning.code)}
		<Alert type="warning">{warning.message}</Alert>
	{/each}

	<ol class="divide-y divide-base-300" data-testid="run-of-show-rows">
		{#each beforeSets as row (row)}
			{@render fixedRow(row)}
		{/each}

		{#each runOfShow.slots as slot, i (slot.id)}
			{@const clock = markSlotTiming.for(`${slot.id}:${slot.actualStartAt ? 'clear' : 'now'}`)}
			<li class="flex flex-wrap items-center gap-3 py-2" data-testid="run-of-show-set">
				<div class="w-28 shrink-0 tabular-nums">
					{#if i === 0}
						{@render timeField('firstSet', slot.scheduledStartAt)}
					{:else if slot.scheduledStartAt}
						{formatTime(slot.scheduledStartAt)}
					{:else}
						<span class="text-subtle">—</span>
					{/if}
				</div>
				<div class="min-w-0 grow truncate font-medium">
					{slot.actName ?? m.staff_not_bill_text()}
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<Form remote={clock} class="contents" guard={false}>
						<input {...clock.fields.slotId.as('hidden', slot.id)} />
						<input {...clock.fields.eventId.as('hidden', eventId)} />
						<input {...clock.fields.edge.as('hidden', 'start')} />
						<input {...clock.fields.action.as('hidden', slot.actualStartAt ? 'clear' : 'now')} />
						{@render doneControl(slot.actualStartAt)}
					</Form>
				</div>
			</li>
		{/each}

		{#each afterSets as row (row)}
			{@render fixedRow(row)}
		{/each}
	</ol>

	<Form
		remote={updateProduction}
		class="mt-4 flex flex-wrap items-end gap-3 border-t border-base-300 pt-4"
		guard={false}
		successToast={m.staff_saved_toast()}
	>
		<input {...changeoverFields.id.as('hidden', production.id)} />
		<input {...changeoverFields.eventId.as('hidden', eventId)} />
		<FormField
			field={changeoverFields.changeoverMinutes}
			type="number"
			label={m.staff_events_id_production_run_of_show_changeover_label()}
			value={runOfShow.changeoverMinutes}
			onchange={submitOnChange}
		/>
	</Form>
</InfoCard>

{#snippet fixedRow(row: FixedRow)}
	<li class="flex flex-wrap items-center gap-3 py-2" data-testid="run-of-show-{row}">
		<div class="w-28 shrink-0 tabular-nums">
			{#if row === 'doors'}
				{fixed.doors.at ? formatTime(fixed.doors.at) : '—'}
			{:else}
				{@render timeField(row, fixed[row].at)}
			{/if}
		</div>
		<div class="min-w-0 grow">{labels[row]()}</div>
		<div class="flex shrink-0 items-center gap-2">
			{@render doneButton(row, fixed[row].doneAt)}
		</div>
	</li>
{/snippet}
