<script lang="ts">
	/**
	 * The top of the hours queue, with its actions, and a link to the rest.
	 *
	 * A summary and deliberately not a replacement: no filters, no pagination, no tabs.
	 * The full queue is a page, and a dashboard card that grows a filter bar has become the
	 * table it was meant to summarise.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { IconCheck, IconArrowBackUp, IconAlertTriangle } from '@tabler/icons-svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { formatVolunteerHours } from '$lib/config';
	import { approveVolunteerHours, rejectVolunteerHours } from '$lib/remote/volunteer.remote';
	import type { MemberRef } from '$lib/types/entity';

	type Log = {
		id: string;
		member: MemberRef;
		roleName: string;
		description: string;
		minutes: number;
		workedOn: Date;
		shiftId: string | null;
		uncleared: boolean;
	};

	let { logs, total }: { logs: Log[]; total: number } = $props();
</script>

<InfoCard title="Hours to review">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>
				{title}
				<span class="text-muted font-normal">· {total}</span>
			</CardTitle>
			<Button href="/staff/volunteer/hours" variant="ghost" size="sm">
				{total > logs.length ? `All ${total} →` : 'Open the queue →'}
			</Button>
		</div>
	{/snippet}

	<Table>
		{#snippet head()}
			<th>Member</th>
			<th class="col-support">Role</th>
			<th class="col-support whitespace-nowrap">Worked</th>
			<th class="cell-num">Hours</th>
			<th class="w-px"><span class="sr-only">Actions</span></th>
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
					{#if log.uncleared}
						<!-- Advisory, exactly as on the full queue: a prompt to have a
						     conversation, not a reason to refuse hours already worked. -->
						<span
							class="ml-1 inline-block align-middle text-warning"
							title="Missing a required clearance on the date worked"
						>
							<IconAlertTriangle size={14} />
						</span>
					{/if}
				</td>
				<td class="col-support whitespace-nowrap">{formatDateShort(log.workedOn)}</td>
				<td class="cell-num">{formatVolunteerHours(log.minutes)}</td>
				<td class="w-px">
					<div class="flex justify-end gap-1">
						<Action
							action={approveVolunteerHours.for(log.id)}
							label="Approve"
							iconOnly
							icon={checkIcon}
							variant="ghost"
							size="sm"
							class="text-success"
							modalTitle="Approve these hours?"
							submitLabel="Approve"
							successToast="Hours approved"
						>
							{#snippet form()}
								<input type="hidden" name="id" value={log.id} />
								<p class="text-sm">
									{formatVolunteerHours(log.minutes)} of {log.roleName} by {log.member.title} on
									{formatDateShort(log.workedOn)}.
								</p>
								<p class="text-muted">{log.description}</p>
								<FormField
									name="notes"
									label="Note (optional)"
									type="textarea"
									description="Shared with the member."
								/>
							{/snippet}
						</Action>

						<Action
							action={rejectVolunteerHours.for(log.id)}
							label="Return"
							iconOnly
							icon={returnIcon}
							variant="ghost"
							size="sm"
							class="text-error"
							modalTitle="Return these hours?"
							submitLabel="Return"
							submitVariant="error"
							successToast="Hours returned"
						>
							{#snippet form()}
								<input type="hidden" name="id" value={log.id} />
								<p class="text-sm">
									{formatVolunteerHours(log.minutes)} of {log.roleName} by {log.member.title} on
									{formatDateShort(log.workedOn)}.
								</p>
								<p class="text-muted">{log.description}</p>
								<FormField
									name="notes"
									label="Reason"
									type="textarea"
									description="Required — the member needs this to correct and resubmit."
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
