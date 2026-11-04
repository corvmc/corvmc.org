<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The top of the hours queue, with its actions, and a link to the rest. Only
	 * exceptions wait here; every other log counted when it was entered.
	 *
	 * A summary and deliberately not a replacement: no filters, no pagination, no tabs.
	 * The full queue is a page, and a dashboard card that grows a filter bar has become the
	 * table it was meant to summarise.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import HourLogExceptions from '#lib/components/volunteer/HourLogExceptions.svelte';
	import { IconCheck, IconArrowBackUp } from '@tabler/icons-svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { formatVolunteerHours, type HourLogException } from '#lib/config.js';
	import { approveVolunteerHours, rejectVolunteerHours } from '#lib/remote/volunteer.remote.js';
	import type { MemberRef } from '#lib/types/entity.js';

	type Log = {
		id: string;
		member: MemberRef;
		roleName: string;
		description: string;
		minutes: number;
		workedOn: Date;
		shiftId: string | null;
		exceptions: HourLogException[];
	};

	let { logs, total }: { logs: Log[]; total: number } = $props();
</script>

<InfoCard title={m.staff_volunteer_hours_to_review_card_title()} state={total}>
	{#snippet action()}
		<Button href="/staff/members/volunteers/hours" variant="ghost" size="sm">
			{total > logs.length
				? m.staff_volunteer_hours_to_review_card_all({ total })
				: m.staff_volunteer_hours_to_review_card_open_queue()}
		</Button>
	{/snippet}

	<Table>
		{#snippet head()}
			<th>{m.staff_member()}</th>
			<th class="col-support">{m.staff_role()}</th>
			<th class="col-support whitespace-nowrap">{m.staff_worked()}</th>
			<th class="cell-num">{m.staff_hours()}</th>
			<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
		{/snippet}

		{#each logs as log (log.id)}
			<tr class="hover">
				<td class="cell-primary">
					<EntityIdentity ref={log.member}>
						{#snippet subtitle()}
							<span title={log.description}>{log.description}</span>
						{/snippet}
					</EntityIdentity>
				</td>
				<td class="col-support">
					{log.roleName}
					<HourLogExceptions exceptions={log.exceptions} />
				</td>
				<td class="col-support whitespace-nowrap">{formatDateShort(log.workedOn)}</td>
				<td class="cell-num">{formatVolunteerHours(log.minutes)}</td>
				<td class="w-px">
					<div class="flex w-max justify-end gap-1">
						<Action
							action={approveVolunteerHours.for(log.id)}
							label={m.staff_approve()}
							iconOnly
							icon={checkIcon}
							variant="ghost"
							size="sm"
							class="text-success"
							modalTitle={m.staff_approve_these_hours()}
							submitLabel={m.staff_approve()}
							successToast={m.staff_hours_approved()}
						>
							{#snippet form()}
								<input {...approveVolunteerHours.for(log.id).fields.id.as('hidden', log.id)} />
								<p class="text-sm">
									{m.staff_by({
										formatVolunteerHours: formatVolunteerHours(log.minutes),
										roleName: log.roleName,
										title: log.member.title,
										formatDateShort: formatDateShort(log.workedOn)
									})}
								</p>
								<p class="text-muted">{log.description}</p>
								<FormField
									field={approveVolunteerHours.for(log.id).fields.notes}
									label={m.staff_note_optional()}
									type="textarea"
									description={m.staff_shared_with_member()}
								/>
							{/snippet}
						</Action>

						<Action
							action={rejectVolunteerHours.for(log.id)}
							label={m.staff_return()}
							iconOnly
							icon={returnIcon}
							variant="ghost"
							size="sm"
							class="text-error"
							modalTitle={m.staff_return_these_hours()}
							submitLabel={m.staff_return()}
							submitVariant="error"
							successToast={m.staff_hours_returned()}
						>
							{#snippet form()}
								<input {...rejectVolunteerHours.for(log.id).fields.id.as('hidden', log.id)} />
								<p class="text-sm">
									{m.staff_by({
										formatVolunteerHours: formatVolunteerHours(log.minutes),
										roleName: log.roleName,
										title: log.member.title,
										formatDateShort: formatDateShort(log.workedOn)
									})}
								</p>
								<p class="text-muted">{log.description}</p>
								<FormField
									field={rejectVolunteerHours.for(log.id).fields.notes}
									label={m.staff_reason()}
									type="textarea"
									description={m.staff_required_member_needs_correct_resubmit()}
								/>
							{/snippet}
						</Action>
					</div>
				</td>
			</tr>
		{/each}
	</Table>
</InfoCard>

{#snippet checkIcon()}
	<IconCheck size={16} />
{/snippet}

{#snippet returnIcon()}
	<IconArrowBackUp size={16} />
{/snippet}
