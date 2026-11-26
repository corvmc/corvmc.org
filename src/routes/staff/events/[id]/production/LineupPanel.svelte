<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Action from '#lib/components/ui/Action.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import MoneyField from '#lib/components/ui/Form/MoneyField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { IconArrowUp, IconArrowDown, IconTrash } from '@tabler/icons-svelte';
	import {
		addLineupAct,
		askForArtifact,
		buildRunOfShowFromLineup,
		moveRunOfShowSlot,
		removeLineupAct,
		setRunOfShowTerms,
		updateProduction,
		updateRunOfShowSlot
	} from '#lib/remote/productions.remote.js';
	import { describeTerms } from '#lib/production/terms.js';
	import AddActFields from './AddActFields.svelte';
	import type { RunOfShow } from '#lib/types/run-of-show.js';

	/**
	 * The only place a CMC show's acts are edited (#3272). Each act is a credit
	 * on the bill and a set on the run of show; adding and removing do both.
	 * Guests per act wait for #3274.
	 */
	let {
		eventId,
		production,
		runOfShow,
		riders,
		canBook
	}: {
		eventId: string;
		production: { id: string; actsWanted: number | null };
		runOfShow: RunOfShow;
		riders: {
			id: string;
			name: string;
			empty: boolean;
			entryId: string | null;
			slug: string | null;
		}[];
		canBook: boolean;
	} = $props();

	let canAdd = $state(false);

	const booked = $derived(runOfShow.slots.length + runOfShow.unslotted.length);
	const bookedState = $derived(
		production.actsWanted
			? m.staff_events_id_production_lineup_state_of_text({
					booked,
					wanted: production.actsWanted
				})
			: m.staff_events_id_production_lineup_state_booked_text({ booked })
	);

	const riderOf = (eventBandId: string | null) => riders.find((r) => r.id === eventBandId);
	const hasDeal = (t: RunOfShow['slots'][number]['terms']) =>
		(t.guaranteeCents ?? 0) > 0 || (t.percentageBps ?? 0) > 0 || t.contributed;
	const wantedOptions = [
		{ value: '', label: m.staff_events_id_production_no_target_set_label() },
		...Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))
	];

	function submitOnChange(e: Event) {
		(e.currentTarget as HTMLInputElement).form?.requestSubmit();
	}
</script>

<InfoCard title={m.staff_events_id_production_lineup_title()} state={bookedState} testid="lineup">
	{#snippet action()}
		<Action
			action={addLineupAct}
			label={m.staff_events_id_production_lineup_add_label()}
			variant="ghost"
			size="sm"
			modalTitle={m.staff_events_id_production_lineup_add_title()}
			submitLabel={m.staff_events_id_production_lineup_add_label()}
			successToast={m.staff_events_id_production_lineup_add_toast()}
			canSubmit={canAdd}
		>
			{#snippet form()}
				<AddActFields {eventId} onchoice={(chosen) => (canAdd = chosen)} />
			{/snippet}
		</Action>
	{/snippet}

	<Form remote={updateProduction} class="mb-3 flex items-end gap-3" guard={false}>
		<input {...updateProduction.fields.id.as('hidden', production.id)} />
		<input {...updateProduction.fields.eventId.as('hidden', eventId)} />
		<FormField
			field={updateProduction.fields.actsWanted}
			type="select"
			label={m.staff_events_id_production_lineup_bands_wanted_label()}
			value={production.actsWanted?.toString() ?? ''}
			options={wantedOptions}
			onchange={submitOnChange}
		/>
	</Form>

	{#if runOfShow.slots.length === 0 && runOfShow.unslotted.length === 0}
		<p class="text-muted">{m.staff_events_id_production_lineup_empty_text()}</p>
	{/if}

	<ol class="divide-y divide-base-300" data-testid="lineup-rows">
		{#each runOfShow.slots as slot, i (slot.id)}
			{@const up = moveRunOfShowSlot.for(`${slot.id}:up`)}
			{@const down = moveRunOfShowSlot.for(`${slot.id}:down`)}
			{@const length = updateRunOfShowSlot.for(slot.id)}
			{@const drop = removeLineupAct.for(slot.id)}
			{@const rider = riderOf(slot.eventBandId)}
			<li class="flex flex-col gap-1 py-3" data-testid="lineup-row">
				<div class="flex items-center gap-2">
					<div class="flex shrink-0 items-center">
						<Form remote={up} class="contents" guard={false}>
							<input {...up.fields.eventId.as('hidden', eventId)} />
							<input {...up.fields.slotId.as('hidden', slot.id)} />
							<input {...up.fields.direction.as('hidden', 'up')} />
							<SubmitButton
								label={m.staff_events_id_production_run_of_show_panel_up_label()}
								variant="ghost"
								size="xs"
								icon={upIcon}
								disabled={i === 0}
							/>
						</Form>
						<Form remote={down} class="contents" guard={false}>
							<input {...down.fields.eventId.as('hidden', eventId)} />
							<input {...down.fields.slotId.as('hidden', slot.id)} />
							<input {...down.fields.direction.as('hidden', 'down')} />
							<SubmitButton
								label={m.staff_events_id_production_run_of_show_panel_down_label()}
								variant="ghost"
								size="xs"
								icon={downIcon}
								disabled={i === runOfShow.slots.length - 1}
							/>
						</Form>
					</div>
					<span class="min-w-0 grow truncate font-medium">
						{slot.actName ?? m.staff_not_bill_text()}
					</span>
					<Form remote={length} class="flex items-center gap-1" guard={false}>
						<input {...length.fields.eventId.as('hidden', eventId)} />
						<input {...length.fields.slotId.as('hidden', slot.id)} />
						<FormField
							field={length.fields.setLengthMinutes}
							type="number"
							class="w-20"
							aria-label={m.staff_events_id_production_lineup_set_length_label()}
							value={slot.setLengthMinutes}
							onchange={submitOnChange}
						/>
					</Form>
					<Action
						action={drop}
						label={m.staff_events_id_production_lineup_remove_label()}
						iconOnly
						icon={trashIcon}
						variant="ghost"
						size="sm"
						class="text-error"
						modalTitle={m.staff_events_id_production_lineup_remove_title()}
						submitLabel={m.staff_events_id_production_lineup_remove_label()}
						submitVariant="error"
						successToast={m.staff_events_id_production_lineup_remove_toast()}
					>
						{#snippet form()}
							<input {...drop.fields.eventId.as('hidden', eventId)} />
							<input {...drop.fields.slotId.as('hidden', slot.id)} />
							<p class="text-sm">
								{m.staff_events_id_production_lineup_remove_text({
									name: slot.actName ?? m.staff_not_bill_text()
								})}
								{#if slot.actOrganizationId && slot.actSlug}
									{m.staff_events_id_production_lineup_remove_claim_text()}
								{/if}
							</p>
						{/snippet}
					</Action>
				</div>

				{#if slot.eventBandId}
					<div class="flex flex-wrap items-center gap-x-4 gap-y-1 pl-16 text-sm">
						{#if rider?.slug && !rider.empty}
							<Button
								href={resolve('/band/[slug]/rider/list', { slug: rider.slug })}
								variant="ghost"
								size="xs"
							>
								{m.staff_events_id_production_lineup_rider_label()}
							</Button>
						{:else if rider?.entryId}
							{@const ask = askForArtifact.for(`rider:${rider.id}`)}
							<Action
								action={ask}
								label={m.staff_events_id_production_lineup_ask_rider_label()}
								variant="ghost"
								size="xs"
								modalTitle={m.staff_events_id_production_lineup_ask_rider_title()}
								submitLabel={m.staff_events_id_production_lineup_ask_rider_label()}
								successToast={m.staff_events_id_production_lineup_ask_rider_toast()}
								confirm={m.staff_events_id_production_lineup_ask_rider_body({ name: rider.name })}
							>
								{#snippet form()}
									<input {...ask.fields.eventId.as('hidden', eventId)} />
									<input {...ask.fields.entryId.as('hidden', rider.entryId ?? '')} />
									<input {...ask.fields.artifact.as('hidden', 'tech_rider')} />
								{/snippet}
							</Action>
						{/if}

						{#if canBook}
							{@const terms = setRunOfShowTerms.for(slot.id)}
							<Action
								action={terms}
								label={hasDeal(slot.terms)
									? describeTerms(slot.terms)
									: m.staff_events_id_production_lineup_set_deal_label()}
								variant="ghost"
								size="xs"
								modalTitle={m.staff_events_id_production_lineup_deal_title()}
								submitLabel={m.staff_events_id_production_run_of_show_panel_save_terms_label()}
								successToast={m.staff_events_id_production_run_of_show_panel_terms_saved_toast()}
							>
								{#snippet form()}
									<input {...terms.fields.eventId.as('hidden', eventId)} />
									<input {...terms.fields.slotId.as('hidden', slot.id)} />
									<div class="grid gap-4 md:grid-cols-2">
										<MoneyField
											field={terms.fields.guaranteeCents}
											label={m.staff_events_id_production_run_of_show_panel_guarantee_label()}
											value={slot.terms.guaranteeCents}
											description={m.staff_events_id_production_run_of_show_panel_leave_empty_no_body()}
										/>
										<FormField
											field={terms.fields.percentageBps}
											type="number"
											label={m.staff_events_id_production_run_of_show_panel_percentage_basi_label()}
											value={slot.terms.percentageBps ?? undefined}
											description={m.staff_events_id_production_run_of_show_panel_7000_70_body()}
										/>
									</div>
									<FormField
										field={terms.fields.versus}
										type="checkbox"
										label={m.staff_events_id_production_run_of_show_panel_versus_label()}
										checkboxLabel={m.staff_events_id_production_run_of_show_panel_pay_guarantee_p_checkbox()}
										value={slot.terms.versus}
									/>
									<FormField
										field={terms.fields.againstNet}
										type="checkbox"
										label={m.staff_events_id_production_run_of_show_panel_against_net_label()}
										checkboxLabel={m.staff_events_id_production_run_of_show_panel_percentage_net_checkbox()}
										value={slot.terms.againstNet}
									/>
									<FormField
										field={terms.fields.contributed}
										type="checkbox"
										label={m.staff_events_id_production_run_of_show_panel_donated_label()}
										checkboxLabel={m.staff_events_id_production_run_of_show_panel_played_free_rec_checkbox()}
										value={slot.terms.contributed}
									/>
								{/snippet}
							</Action>
						{:else if hasDeal(slot.terms)}
							<span class="text-subtle">{describeTerms(slot.terms)}</span>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ol>

	<!-- Credits on the bill from before the lineup owned the run of show. -->
	{#if runOfShow.unslotted.length > 0}
		<div class="mt-3">
			<Alert type="warning">
				{m.staff_events_id_production_lineup_unplaced_body({
					names: runOfShow.unslotted.map((a) => a.name).join(', ')
				})}
			</Alert>
			<Form remote={buildRunOfShowFromLineup} class="mt-2" guard={false}>
				<input {...buildRunOfShowFromLineup.fields.eventId.as('hidden', eventId)} />
				<input {...buildRunOfShowFromLineup.fields.productionId.as('hidden', production.id)} />
				<SubmitButton
					label={m.staff_events_id_production_lineup_add_missing_label()}
					variant="default"
					size="sm"
				/>
			</Form>
		</div>
	{/if}
</InfoCard>

{#snippet upIcon()}
	<IconArrowUp size={16} />
{/snippet}
{#snippet downIcon()}
	<IconArrowDown size={16} />
{/snippet}
{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}
