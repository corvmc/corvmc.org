<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { formatDateShort } from '#lib/utils/format.js';
	import { clubToday } from '#lib/config.js';
	import { addIsoDays } from '#lib/utils/deadline.js';
	import {
		createCommitteeRecurringWork,
		retireCommitteeRecurringWork
	} from '#lib/remote/maintenance-schedules.remote.js';

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
	const firstDue = addIsoDays(clubToday(), 7);
	const now = Date.now();

	function every(days: number): string {
		if (days === 1) return 'Daily';
		if (days === 7) return 'Weekly';
		if (days % 7 === 0) return `Every ${days / 7} weeks`;
		return `Every ${days} days`;
	}
</script>

<InfoCard title={m.member_groups_slug_committee_recurring_work_title()}>
	{#snippet header()}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{m.member_groups_slug_committee_recurring_work_title()}</CardTitle>
			{#if canEdit && roles.length > 0}
				<Action
					action={createCommitteeRecurringWork}
					label={m.member_groups_slug_committee_recurring_work_add()}
					modalTitle={m.member_groups_slug_committee_recurring_work_add_recurring_wo()}
					submitLabel={m.member_groups_slug_committee_recurring_work_add()}
					successToast={m.member_groups_slug_committee_recurring_work_recurring_work_a()}
					variant="ghost"
					size="sm"
				>
					{#snippet form()}
						<input {...fields.groupId.as('hidden', groupId)} />
						<Field
							field={fields.name}
							type="text"
							label={m.member_name()}
							placeholder={m.member_groups_slug_committee_recurring_work_placeholder()}
						/>
						<Field
							field={fields.volunteerRoleId}
							type="select"
							label={m.member_role()}
							options={roles}
						/>
						<Field
							field={fields.intervalDays}
							type="number"
							label={m.member_groups_slug_committee_recurring_work_repeat_every_day()}
							value="7"
							description={m.member_groups_slug_committee_recurring_work_counted_from_whe()}
						/>
						<Field
							field={fields.firstDueOn}
							type="date"
							label={m.member_groups_slug_committee_recurring_work_first_one_due()}
							value={firstDue}
						/>
						<Field
							field={fields.capacity}
							type="number"
							label={m.member_groups_slug_committee_recurring_work_how_many_people()}
							value="1"
						/>
						<Field field={fields.notes} type="textarea" label={m.member_what_needs_doing()} />
					{/snippet}
				</Action>
			{/if}
		</div>
	{/snippet}

	{#if schedules.length === 0}
		<EmptyState description={m.member_groups_slug_committee_recurring_work_work_committee_d()} />
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.member_status()}</span></th>
				<th>{m.member_name()}</th>
				<th>{m.member_groups_slug_committee_recurring_work_repeats()}</th>
				<th>{m.member_groups_slug_committee_recurring_work_next_due()}</th>
				{#if canEdit}<th><span class="sr-only">{m.member_actions()}</span></th>{/if}
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
									label={m.member_groups_slug_committee_recurring_work_retire()}
									aria-label={m.member_groups_slug_committee_recurring_work_aria_label({
										name: s.name
									})}
									variant="ghost"
									size="xs"
									modalTitle={m.member_groups_slug_committee_recurring_work_retire_recurring()}
									submitLabel={m.member_groups_slug_committee_recurring_work_retire()}
									submitVariant="error"
									successToast={m.member_groups_slug_committee_recurring_work_retired()}
								>
									{#snippet form()}
										<input {...retire.fields.id.as('hidden', s.id)} />
										<p>
											<ParaglideMessage
												message={m.member_groups_slug_committee_recurring_work_stop_writing_new}
												inputs={{ name: s.name }}
												>{#snippet strong({ children })}<strong>{@render children?.()}</strong
													>{/snippet}</ParaglideMessage
											>
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
