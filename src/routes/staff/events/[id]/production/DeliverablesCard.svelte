<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { reassignDeliverableForm } from '#lib/remote/deliverables.remote.js';
	import type { getStaffEventProduction } from '#lib/remote/events.remote.js';

	type Loaded = Awaited<ReturnType<typeof getStaffEventProduction>>;

	/**
	 * Whose job each piece of this show is, and whether it is done (#1701). The
	 * state is derived from the show, so it moves on its own as the facts change.
	 */
	let {
		eventId,
		items,
		committees
	}: {
		eventId: string;
		items: Loaded['deliverables'];
		committees: Loaded['deliverableCommittees'];
	} = $props();

	const owners = $derived([
		{ value: '', label: m.staff_staff() },
		...committees.map((c) => ({ value: c.id, label: c.name }))
	]);

	const STATE = {
		done: { label: m.staff_events_id_production_deliverables_card_done(), variant: 'success' },
		overdue: { label: m.staff_overdue(), variant: 'error' },
		open: { label: m.staff_open(), variant: 'ghost' },
		cancelled: { label: m.staff_cancelled(), variant: 'ghost' }
	} as const;
</script>

{#if items.length > 0}
	<InfoCard title={m.staff_events_id_production_deliverables_card_title()}>
		<Table>
			{#snippet head()}
				<th>{m.staff_item()}</th>
				<th>{m.staff_events_id_production_deliverables_card_owner()}</th>
				<th>{m.staff_events_id_production_deliverables_card_who()}</th>
				<th>{m.staff_due()}</th>
				<th class="w-px">{m.staff_events_id_production_deliverables_card_state()}</th>
				<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
			{/snippet}
			{#each items as item (item.id)}
				<tr>
					<td class="cell-primary">
						{item.title}
						{#if item.artAwaitingUse}
							<div class="text-muted text-sm font-normal">
								{m.staff_events_id_production_deliverables_card_art_waiting_use()}
							</div>
						{/if}
					</td>
					<td>{item.groupName ?? m.staff_staff()}</td>
					<td>
						{item.assignees.length > 0
							? item.assignees.map((a) => a.name).join(', ')
							: m.staff_events_id_production_deliverables_card_nobody_yet()}
					</td>
					<td class="whitespace-nowrap">{item.dueAt ? formatDateShort(item.dueAt) : '—'}</td>
					<td class="w-px">
						<Badge variant={STATE[item.state].variant} size="sm">{STATE[item.state].label}</Badge>
					</td>
					<td class="w-px">
						{#if item.state === 'open' || item.state === 'overdue'}
							<Action
								action={reassignDeliverableForm.for(item.id)}
								label={m.staff_events_id_production_deliverables_card_reassign()}
								aria-label={m.staff_events_id_production_deliverables_card_aria_label({
									title: item.title
								})}
								modalTitle={m.staff_events_id_production_deliverables_card_reassign()}
								submitLabel={m.staff_events_id_production_deliverables_card_reassign()}
								variant="ghost"
								size="xs"
								successToast={m.staff_events_id_production_deliverables_card_success_toast()}
							>
								{#snippet form()}
									<input type="hidden" name="id" value={item.id} />
									<input type="hidden" name="eventId" value={eventId} />
									<FormField
										name="groupId"
										label={m.staff_events_id_production_deliverables_card_owner()}
										type="select"
										options={owners}
										value={item.groupId ?? ''}
									/>
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	</InfoCard>
{/if}
