<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { setShowLead, searchShowLeadCandidates } from '#lib/remote/productions.remote.js';
	import type { getStaffEventPage } from '#lib/remote/events.remote.js';
	import CrewAssign from './CrewAssign.svelte';

	/**
	 * A CMC show's crew (#3270): the event lead, then each shift, each row the
	 * person or Assign. Shift times are not shown. Assign on a shift opens the
	 * task's own staffing — its assignees and "Who to ask" — for that shift.
	 */
	type Page = Awaited<ReturnType<typeof getStaffEventPage>>;
	let {
		eventId,
		production,
		crew,
		canSetLead,
		onchange
	}: {
		eventId: string;
		production: Page['production'];
		crew: NonNullable<Page['sidebar']['crew']>;
		canSetLead: boolean;
		onchange: () => void;
	} = $props();

	const filled = $derived(
		(production?.producerUserId ? 1 : 0) +
			crew.reduce((n, s) => n + Math.min(s.people.length, s.capacity), 0)
	);
	const places = $derived((production ? 1 : 0) + crew.reduce((n, s) => n + s.capacity, 0));

	let leadId = $state('');
	let leadName = $state('');
	let assigning = $state<{ workOrderId: string; shiftId: string } | null>(null);
	let assignOpen = $state(false);
</script>

<InfoCard
	title={m.staff_events_id_crew_title()}
	state={m.staff_events_id_crew_filled_label({ filled, places })}
	testid="crew"
>
	<ul class="flex flex-col divide-y divide-base-200 text-sm">
		{#if production}
			<li class="flex items-center justify-between gap-2 py-2" data-testid="crew-lead">
				<span class="text-muted">{m.staff_events_id_production_lead_text()}</span>
				{#if production.producer}
					<EntityChip ref={production.producer} />
				{:else if canSetLead}
					<Action
						action={setShowLead}
						label={m.staff_events_id_crew_assign_label()}
						modalTitle={m.staff_events_id_crew_assign_lead_title()}
						successToast={m.staff_events_id_production_lead_saved_toast()}
						variant="ghost"
						size="sm"
						onsuccess={onchange}
					>
						{#snippet form()}
							<input {...setShowLead.fields.id.as('hidden', production.id)} />
							<input {...setShowLead.fields.eventId.as('hidden', eventId)} />
							<MemberPicker
								field={setShowLead.fields.leadUserId}
								label={m.staff_events_id_production_lead_label()}
								placeholder={m.staff_events_id_production_lead_search_placeholder()}
								search={(q) => searchShowLeadCandidates({ eventId, q })}
								bind:value={leadId}
								bind:name={leadName}
							/>
						{/snippet}
					</Action>
				{:else}
					<span class="text-muted">{m.staff_events_id_production_no_lead_text()}</span>
				{/if}
			</li>
		{/if}
		{#each crew as shift (shift.shiftId)}
			<li class="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="crew-shift">
				<span class="text-muted">{shift.label}</span>
				<span class="flex flex-wrap items-center justify-end gap-2">
					{#each shift.people as person (person.userId)}
						<span class="font-medium">{person.name}</span>
					{/each}
					{#if shift.people.length < shift.capacity}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => {
								assigning = { workOrderId: shift.workOrderId, shiftId: shift.shiftId };
								assignOpen = true;
							}}
						>
							{m.staff_events_id_crew_assign_label()}
						</Button>
					{/if}
				</span>
			</li>
		{/each}
	</ul>
</InfoCard>

<Modal
	bind:open={assignOpen}
	title={m.staff_events_id_crew_assign_shift_title()}
	maxWidth="max-w-xl"
	onclose={onchange}
>
	{#if assigning}
		<CrewAssign workOrderId={assigning.workOrderId} shiftId={assigning.shiftId} />
	{/if}
</Modal>
