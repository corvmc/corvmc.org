<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { reassignDeliverableForm } from '$lib/remote/deliverables.remote';
	import type { getStaffEventProduction } from '$lib/remote/events.remote';

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
		{ value: '', label: 'Staff' },
		...committees.map((c) => ({ value: c.id, label: c.name }))
	]);

	const STATE = {
		done: { label: 'Done', variant: 'success' },
		overdue: { label: 'Overdue', variant: 'error' },
		open: { label: 'Open', variant: 'ghost' },
		cancelled: { label: 'Cancelled', variant: 'ghost' }
	} as const;
</script>

{#if items.length > 0}
	<InfoCard title="Deliverables">
		<Table>
			{#snippet head()}
				<th>Item</th>
				<th>Owner</th>
				<th>Who</th>
				<th>Due</th>
				<th class="w-px">State</th>
				<th class="w-px"><span class="sr-only">Actions</span></th>
			{/snippet}
			{#each items as item (item.id)}
				<tr>
					<td class="cell-primary">
						{item.title}
						{#if item.artAwaitingUse}
							<div class="text-muted text-sm font-normal">Art is in; waiting for it to be used</div>
						{/if}
					</td>
					<td>{item.groupName ?? 'Staff'}</td>
					<td>
						{item.assignees.length > 0
							? item.assignees.map((a) => a.name).join(', ')
							: 'Nobody yet'}
					</td>
					<td class="whitespace-nowrap">{item.dueAt ? formatDateShort(item.dueAt) : '—'}</td>
					<td class="w-px">
						<Badge variant={STATE[item.state].variant} size="sm">{STATE[item.state].label}</Badge>
					</td>
					<td class="w-px">
						{#if item.state === 'open' || item.state === 'overdue'}
							<Action
								action={reassignDeliverableForm.for(item.id)}
								label="Reassign"
								aria-label={`Reassign ${item.title}`}
								modalTitle="Reassign"
								submitLabel="Reassign"
								variant="ghost"
								size="xs"
								successToast="Reassigned"
							>
								{#snippet form()}
									<input type="hidden" name="id" value={item.id} />
									<input type="hidden" name="eventId" value={eventId} />
									<FormField
										name="groupId"
										label="Owner"
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
