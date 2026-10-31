<script lang="ts">
	/**
	 * Hours logged against this work order, approved from here as from the queue.
	 * Returning a log stays on the queue, where the note to the member is written.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { approveVolunteerHours, type getStaffShiftPage } from '$lib/remote/volunteer.remote';
	import { formatVolunteerHours, volunteerHourStatusLabels } from '$lib/config';
	import { formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	type Log = Awaited<ReturnType<typeof getStaffShiftPage>>['hours'][number];
	let { hours, shiftId }: { hours: Log[]; shiftId: string } = $props();

	const variant = { pending: 'warning', approved: 'success', rejected: 'ghost' } as const;
</script>

<InfoCard title="Hours">
	<ul class="flex flex-col gap-3">
		{#each hours as log (log.id)}
			<li class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex min-w-0 flex-wrap items-center gap-2">
					<EntityIdentity ref={log.member} size="sm" />
					<span class="text-sm">
						{formatVolunteerHours(log.minutes)} · {formatDateShort(log.workedOn)}
					</span>
					<Badge variant={variant[log.status]} size="xs">
						{volunteerHourStatusLabels[log.status]}
					</Badge>
				</div>
				{#if log.status === 'pending'}
					{@const approve = approveVolunteerHours.for(log.id)}
					<Action
						action={approve}
						label="Approve"
						variant="ghost"
						size="sm"
						class="text-success"
						modalTitle="Approve these hours?"
						submitLabel="Approve"
						successToast="Hours approved"
					>
						{#snippet form()}
							<input type="hidden" name="id" value={log.id} />
							<input type="hidden" name="shiftId" value={shiftId} />
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
				{/if}
			</li>
		{/each}
	</ul>
	<p class="mt-2 text-subtle text-xs">
		To return a log for correction, use the <a
			class="link"
			href={resolve('/staff/members/volunteers/hours')}>hours queue</a
		>.
	</p>
</InfoCard>
