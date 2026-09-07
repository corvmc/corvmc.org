<script lang="ts">
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import Field from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { formatTime, toLocalTime } from '$lib/utils/format';
	import { IconArrowUp, IconArrowDown, IconTrash } from '@tabler/icons-svelte';
	import {
		addRunOfShowSlot,
		updateRunOfShowSlot,
		moveRunOfShowSlot,
		removeRunOfShowSlot,
		buildRunOfShowFromLineup
	} from '$lib/remote/productions.remote';
	import type { RunOfShow } from '$lib/types/run-of-show';

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
		{ value: '', label: 'Not on the bill (a DJ, a host)' },
		...(runOfShow?.unslotted ?? []).map((act) => ({ value: act.eventBandId, label: act.name }))
	]);

	function warningsFor(slotId: string) {
		return (runOfShow?.warnings ?? []).filter((w) => w.slotId === slotId);
	}

	const showWarnings = $derived((runOfShow?.warnings ?? []).filter((w) => w.slotId === null));
</script>

{#if !runOfShow}
	<EmptyState
		title="No production yet"
		description="Open one on the Overview tab, and the running order lives here."
	/>
{:else}
	<InfoCard title="The night">
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
			Set the first set time on the Overview tab and the running order will schedule itself.
		</Alert>
	{/if}

	{#each showWarnings as warning (warning.code)}
		<Alert type="warning">{warning.message}</Alert>
	{/each}

	{#if runOfShow.slots.length === 0}
		<EmptyState title="Nothing on stage yet" description="Build the running order from the bill.">
			<Form remote={buildRunOfShowFromLineup} successToast="Running order built">
				<input {...buildRunOfShowFromLineup.fields.eventId.as('hidden', eventId)} />
				<input
					{...buildRunOfShowFromLineup.fields.productionId.as('hidden', runOfShow.productionId)}
				/>
				<SubmitButton label="Build from the bill" />
			</Form>
		</EmptyState>
	{:else}
		<ul class="divide-y divide-base-300 rounded-box border border-base-300">
			{#each runOfShow.slots as slot, i (slot.id)}
				{@const up = moveRunOfShowSlot.for(`${slot.id}:up`)}
				{@const down = moveRunOfShowSlot.for(`${slot.id}:down`)}
				{@const edit = updateRunOfShowSlot.for(slot.id)}
				{@const drop = removeRunOfShowSlot.for(slot.id)}
				<li class="p-3">
					<div class="flex flex-wrap items-center gap-3">
						<div class="w-36 shrink-0 tabular-nums">
							{#if slot.scheduledStartAt && slot.scheduledEndAt}
								{formatTime(slot.scheduledStartAt)} – {formatTime(slot.scheduledEndAt)}
							{:else}
								<span class="text-subtle">—</span>
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
								{slot.setLengthMinutes} min set · {slot.changeoverMinutes} min changeover
								{#if slot.soundcheckAt}
									· soundcheck {formatTime(slot.soundcheckAt)}
								{/if}
							</div>
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
									label="Up"
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
									label="Down"
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
								label="Remove"
								iconOnly
								icon={trashIcon}
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle="Remove this set?"
								submitLabel="Remove"
								submitVariant="error"
								successToast="Set removed"
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
						<Form remote={edit} guard successToast="Saved" class="mt-3 space-y-4">
							<input {...edit.fields.eventId.as('hidden', eventId)} />
							<input {...edit.fields.slotId.as('hidden', slot.id)} />
							<input {...edit.fields.soundcheckDate.as('hidden', showDate)} />
							<div class="grid gap-4 md:grid-cols-3">
								<Field
									field={edit.fields.setLengthMinutes}
									type="number"
									label="Set length (minutes)"
									value={slot.setLengthMinutes}
								/>
								<Field
									field={edit.fields.changeoverMinutes}
									type="number"
									label="Changeover after (minutes)"
									value={slot.changeoverMinutes}
								/>
								<Field
									field={edit.fields.soundcheckTime}
									type="time"
									label="Soundcheck"
									value={slot.soundcheckAt ? toLocalTime(slot.soundcheckAt) : ''}
									description="Not part of the schedule — it usually runs in reverse."
								/>
							</div>
							<Field
								field={edit.fields.techNotes}
								type="textarea"
								label="Tech notes"
								value={slot.techNotes ?? ''}
							/>
							<Field
								field={edit.fields.backlineNeeds}
								type="textarea"
								label="Backline"
								value={slot.backlineNeeds ?? ''}
							/>
							<Field
								field={edit.fields.hospitalityNotes}
								type="textarea"
								label="Hospitality"
								value={slot.hospitalityNotes ?? ''}
							/>
							<div class="grid gap-4 md:grid-cols-3">
								<Field
									field={edit.fields.contactName}
									label="Contact for this show"
									value={slot.contactName ?? ''}
									description="A tour manager, when it is not the act's usual contact."
								/>
								<Field
									field={edit.fields.contactEmail}
									type="email"
									label="Email"
									value={slot.contactEmail ?? ''}
								/>
								<Field
									field={edit.fields.contactPhone}
									type="tel"
									label="Phone"
									value={slot.contactPhone ?? ''}
								/>
							</div>
							<div class="flex justify-end"><SubmitButton label="Save" /></div>
						</Form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<InfoCard title="Add a set">
		<Form remote={addRunOfShowSlot} successToast="Set added" class="space-y-4">
			<input {...addFields.eventId.as('hidden', eventId)} />
			<input {...addFields.productionId.as('hidden', runOfShow.productionId)} />
			<div class="grid gap-4 md:grid-cols-3">
				<Field field={addFields.eventBandId} type="select" label="Act" options={actOptions} />
				<Field
					field={addFields.setLengthMinutes}
					type="number"
					label="Set length (minutes)"
					value={30}
				/>
				<Field
					field={addFields.changeoverMinutes}
					type="number"
					label="Changeover after (minutes)"
					value={10}
				/>
			</div>
			<div class="flex justify-end"><SubmitButton label="Add" /></div>
		</Form>
		{#if runOfShow.unslotted.length > 0}
			<p class="mt-2 text-subtle">
				Still off the running order: {runOfShow.unslotted.map((a) => a.name).join(', ')}
			</p>
		{:else if runOfShow.slots.length > 0}
			<p class="mt-2 text-subtle">Every act on the bill has a set.</p>
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
