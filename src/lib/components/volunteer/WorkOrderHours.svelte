<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	/**
	 * Hours logged against this work order, approved from here as from the queue.
	 * Returning a log stays on the queue, where the note to the member is written.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { approveVolunteerHours, type getStaffShiftPage } from '#lib/remote/volunteer.remote.js';
	import { formatVolunteerHours, volunteerHourStatusLabels } from '#lib/config.js';
	import { formatDateShort } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';

	type Log = Awaited<ReturnType<typeof getStaffShiftPage>>['hours'][number];
	let { hours, shiftId }: { hours: Log[]; shiftId: string } = $props();

	const variant = { pending: 'warning', approved: 'success', rejected: 'ghost' } as const;
</script>

<InfoCard title={m.volunteer_hours_title()}>
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
						label={m.volunteer_work_order_hours_approve_label()}
						variant="ghost"
						size="sm"
						class="text-success"
						modalTitle={m.volunteer_work_order_hours_modal_title()}
						submitLabel={m.volunteer_work_order_hours_approve_label()}
						successToast={m.volunteer_work_order_hours_success_toast()}
					>
						{#snippet form()}
							<input {...approve.fields.id.as('hidden', log.id)} />
							<input {...approve.fields.shiftId.as('hidden', shiftId)} />
							<p class="text-sm">
								{m.volunteer_work_order_hours_by_text({
									formatVolunteerHours: formatVolunteerHours(log.minutes),
									roleName: log.roleName,
									title: log.member.title,
									formatDateShort: formatDateShort(log.workedOn)
								})}
							</p>
							<p class="text-muted">{log.description}</p>
							<FormField
								field={approve.fields.notes}
								label={m.volunteer_work_order_hours_note_optional_label()}
								type="textarea"
								description={m.volunteer_work_order_hours_description_body()}
							/>
						{/snippet}
					</Action>
				{/if}
			</li>
		{/each}
	</ul>
	<p class="mt-2 text-subtle text-xs">
		<ParaglideMessage
			message={m.volunteer_work_order_hours_return_log_correction_use_text}
			inputs={{}}
			>{#snippet a({ children })}<a class="link" href={resolve('staff/members/volunteers/hours')}
					>{@render children?.()}</a
				>{/snippet}</ParaglideMessage
		>
	</p>
</InfoCard>
