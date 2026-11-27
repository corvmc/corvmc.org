<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { openHostShift } from '#lib/remote/productions.remote.js';
	import { openEventLeadTask, type getStaffEventPage } from '#lib/remote/events.remote.js';
	import CrewAssign from './CrewAssign.svelte';

	/**
	 * A CMC show's crew (#3270): the event lead, then each shift, each row the
	 * person or Assign. Shift times are not shown. Assign opens the task's own
	 * staffing — its assignees and "Who to ask" — and the event lead is a task
	 * with no shift (#3274). A show with no host task offers to open one; once
	 * open it is a shift row.
	 */
	type Page = Awaited<ReturnType<typeof getStaffEventPage>>;
	let {
		eventId,
		production,
		crew,
		lead,
		canAssignLead,
		hostOpen,
		onchange
	}: {
		eventId: string;
		production: Page['production'];
		crew: NonNullable<Page['sidebar']['crew']>;
		lead: Page['sidebar']['lead'];
		canAssignLead: boolean;
		hostOpen: boolean;
		onchange: () => void;
	} = $props();

	const leadHeld = $derived((lead?.people.length ?? 0) > 0 || !!production?.producer);
	const filled = $derived(
		(leadHeld ? 1 : 0) + crew.reduce((n, s) => n + Math.min(s.people.length, s.capacity), 0)
	);
	const places = $derived((production ? 1 : 0) + crew.reduce((n, s) => n + s.capacity, 0));

	let assigning = $state<{ workOrderId: string; shiftId?: string } | null>(null);
	let assignOpen = $state(false);
	let noLeadRole = $state(false);

	/** The task may not exist yet on a show opened before the role did. */
	async function assignLead() {
		const workOrderId = lead?.workOrderId ?? (await openEventLeadTask({ eventId })).workOrderId;
		noLeadRole = workOrderId === null;
		if (!workOrderId) return;
		assigning = { workOrderId };
		assignOpen = true;
	}
</script>

<InfoCard
	title={m.staff_events_id_crew_title()}
	state={m.staff_events_id_crew_filled_label({ filled, places })}
	testid="crew"
>
	<ul class="flex flex-col divide-y divide-base-200 text-sm">
		{#if production}
			<li class="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="crew-lead">
				<span class="text-muted">{m.staff_events_id_production_lead_text()}</span>
				<span class="flex flex-wrap items-center justify-end gap-2">
					{#each lead?.people ?? [] as person (person.userId)}
						<span class="font-medium">{person.name}</span>
					{/each}
					{#if production.producer && !lead?.people.some((p) => p.userId === production.producerUserId)}
						<EntityChip ref={production.producer} />
					{/if}
					{#if (lead?.people.length ?? 0) === 0}
						{#if noLeadRole}
							<span class="text-muted">{m.staff_events_id_crew_no_lead_role_text()}</span>
						{:else if canAssignLead}
							<Button variant="ghost" size="sm" onclick={assignLead}>
								{m.staff_events_id_crew_assign_label()}
							</Button>
						{:else if !production.producer}
							<span class="text-muted">{m.staff_events_id_production_no_lead_text()}</span>
						{/if}
					{/if}
				</span>
			</li>
		{/if}
		{#if production && !hostOpen}
			<li class="flex items-center justify-between gap-2 py-2" data-testid="crew-host">
				<span class="text-muted">{m.staff_events_id_production_host_text()}</span>
				<Form
					remote={openHostShift}
					successToast={m.staff_events_id_production_host_shift_opened_toast()}
					onsuccess={onchange}
				>
					<input {...openHostShift.fields.eventId.as('hidden', eventId)} />
					<SubmitButton
						label={m.staff_events_id_production_open_host_shift_label()}
						variant="ghost"
						size="sm"
					/>
				</Form>
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
	title={assigning?.shiftId
		? m.staff_events_id_crew_assign_shift_title()
		: m.staff_events_id_crew_assign_lead_title()}
	maxWidth="max-w-xl"
	onclose={onchange}
>
	{#if assigning}
		<CrewAssign workOrderId={assigning.workOrderId} shiftId={assigning.shiftId} />
	{/if}
</Modal>
