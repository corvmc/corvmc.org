<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { formatDateShort } from '$lib/utils/format';
	import {
		createCommitteeRecurringWork,
		retireCommitteeRecurringWork
	} from '$lib/remote/maintenance-schedules.remote';

	/**
	 * A committee's standing checklist: Booking's weekly holds, Facilities' monthly
	 * walk-through. Each item writes one work order at a time; closing it writes the next.
	 */
	let {
		groupId,
		schedules,
		roles,
		canEdit
	}: {
		groupId: string;
		schedules: {
			id: string;
			name: string;
			intervalDays: number;
			roleName: string;
			retiredAt: Date | null;
			openDueAt: Date | null;
			lastClosedAt: Date | null;
		}[];
		roles: { value: string; label: string }[];
		canEdit: boolean;
	} = $props();

	const fields = createCommitteeRecurringWork.fields;
	const firstDue = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
	const now = Date.now();

	function every(days: number): string {
		if (days === 1) return 'Daily';
		if (days === 7) return 'Weekly';
		if (days % 7 === 0) return `Every ${days / 7} weeks`;
		return `Every ${days} days`;
	}
</script>

<InfoCard title="Recurring work">
	{#snippet header()}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>Recurring work</CardTitle>
			{#if canEdit && roles.length > 0}
				<Action
					action={createCommitteeRecurringWork}
					label="Add"
					modalTitle="Add recurring work"
					submitLabel="Add"
					successToast="Recurring work added"
					variant="ghost"
					size="sm"
				>
					{#snippet form()}
						<input {...fields.groupId.as('hidden', groupId)} />
						<Field field={fields.name} type="text" label="Name" placeholder="Weekly holds review" />
						<Field field={fields.volunteerRoleId} type="select" label="Role" options={roles} />
						<Field
							field={fields.intervalDays}
							type="number"
							label="Repeat every (days)"
							value="7"
							description="Counted from when the last one closed."
						/>
						<Field field={fields.firstDueOn} type="date" label="First one due" value={firstDue} />
						<Field field={fields.capacity} type="number" label="How many people" value="1" />
						<Field field={fields.notes} type="textarea" label="What needs doing" />
					{/snippet}
				</Action>
			{/if}
		</div>
	{/snippet}

	{#if schedules.length === 0}
		<EmptyState
			description="Work this committee does on a cycle. The next one appears when the last is closed."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Name</th>
				<th>Repeats</th>
				<th>Next due</th>
				{#if canEdit}<th><span class="sr-only">Actions</span></th>{/if}
			{/snippet}
			{#each schedules as s (s.id)}
				<tr>
					<td><StatusBadge status={s.retiredAt ? 'archived' : 'active'} label /></td>
					<td class="cell-primary">
						{s.name}
						<div class="text-subtle text-sm">{s.roleName}</div>
					</td>
					<td class="whitespace-nowrap">{every(s.intervalDays)}</td>
					<td class="whitespace-nowrap">
						{#if s.openDueAt}
							<span class:text-error={s.openDueAt.getTime() < now}
								>{formatDateShort(s.openDueAt)}</span
							>
						{:else}
							<span class="text-subtle">—</span>
						{/if}
					</td>
					{#if canEdit}
						<td class="text-right">
							{#if !s.retiredAt}
								{@const retire = retireCommitteeRecurringWork.for(s.id)}
								<Action
									action={retire}
									label="Retire"
									aria-label={`Retire ${s.name}`}
									variant="ghost"
									size="xs"
									modalTitle="Retire recurring work"
									submitLabel="Retire"
									submitVariant="error"
									successToast="Retired"
								>
									{#snippet form()}
										<input {...retire.fields.id.as('hidden', s.id)} />
										<p>
											Stop writing new <strong>{s.name}</strong> work orders? The open one stays until
											someone closes it.
										</p>
									{/snippet}
								</Action>
							{/if}
						</td>
					{/if}
				</tr>
			{/each}
		</Table>
	{/if}
</InfoCard>
