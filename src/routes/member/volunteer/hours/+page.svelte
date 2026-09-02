<script lang="ts">
	/**
	 * Your hours: the whole history, and the one part of it that needs you.
	 *
	 * Split off the dashboard because a log filed in March is not a next action.
	 * The state that *is* one — a returned log — was buried under everything
	 * already approved; here it is tinted, carries the staff reason in full, and
	 * has the button that fixes it.
	 *
	 * "Returned", never "rejected": it is a request for a correction, not a
	 * judgement, and the stored value differs from the label on purpose.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import LogHoursAction from '$lib/components/volunteer/LogHoursAction.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { formatVolunteerHours, volunteerHourStatusLabels, DEFAULT_TIMEZONE } from '$lib/config';
	import { getMemberHoursPage, withdrawVolunteerHours } from '$lib/remote/volunteer.remote';

	const data = $derived(await getMemberHoursPage());

	function toDateInput(date: Date): string {
		return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(new Date(date));
	}

	const returnedMinutes = $derived(
		data.logs.filter((l) => l.status === 'rejected').reduce((n, l) => n + l.minutes, 0)
	);

	const pip: Record<string, string> = {
		approved: 'bg-success',
		pending: 'bg-warning',
		rejected: 'bg-error'
	};
</script>

<PageHeader title="Your hours" subtitle="Volunteering" backHref="/member/volunteer">
	<LogHoursAction roles={data.roles} label="Log Hours" variant="primary" />
</PageHeader>

<PageContent width="3xl">
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<StatCard title="Approved" value={formatVolunteerHours(data.summary.approvedMinutes)} />
		<StatCard title="Awaiting review" value={formatVolunteerHours(data.summary.pendingMinutes)} />
		<StatCard title="Returned" value={formatVolunteerHours(returnedMinutes)} />
	</div>

	<InfoCard title="Everything you've filed">
		{#if data.logs.length === 0}
			<EmptyState
				title="Nothing filed yet"
				description="Log hours for anything you've helped with — staff read the description when reviewing."
			/>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each data.logs as log (log.id)}
					<li
						class="rounded-lg border border-base-300 p-3"
						class:bg-error-content={log.status === 'rejected'}
					>
						<div class="flex flex-wrap items-center gap-2">
							<span class="size-2 rounded-full {pip[log.status]}"></span>
							<span class="font-medium">{log.roleName}</span>
							<Badge
								variant={log.status === 'approved'
									? 'success'
									: log.status === 'rejected'
										? 'error'
										: 'warning'}
								size="sm"
							>
								{volunteerHourStatusLabels[log.status]}
							</Badge>
							<span class="ml-auto text-subtle text-sm">
								{formatVolunteerHours(log.minutes)} · {formatDateShort(log.workedOn)}
							</span>
						</div>

						<p class="mt-1 text-sm">{log.description}</p>

						{#if log.status === 'rejected' && log.reviewNotes}
							<!-- In full, never truncated: it is the instruction for what to
							     change, and a clipped one sends them back to guess. -->
							<p class="mt-2 text-sm text-error">{log.reviewNotes}</p>
						{/if}

						{#if log.status !== 'approved'}
							<div class="mt-2 flex flex-wrap gap-2">
								<LogHoursAction
									mode="fix"
									size="xs"
									label={log.status === 'rejected' ? 'Fix it' : 'Edit'}
									log={{
										id: log.id,
										volunteerRoleId: log.volunteerRoleId,
										workedOn: toDateInput(log.workedOn),
										hours: String(log.minutes / 60),
										description: log.description
									}}
								/>
								<Action
									action={withdrawVolunteerHours.for(log.id)}
									label="Withdraw"
									variant="ghost"
									size="xs"
									class="text-error"
									modalTitle="Withdraw this log?"
									submitLabel="Withdraw"
									submitVariant="error"
									successToast="Withdrawn"
								>
									{#snippet form()}
										<input type="hidden" name="id" value={log.id} />
										<p class="text-sm">
											It comes off the record entirely. File it again any time — nothing about the
											work you did changes.
										</p>
									{/snippet}
								</Action>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="mt-3 text-subtle text-xs">
				Approved hours are locked — they are the record a funder reads. Ask staff if one needs
				changing.
			</p>
		{/if}
	</InfoCard>

	<Button href={resolve('/member/volunteer')} variant="ghost" size="sm"
		>← Back to volunteering</Button
	>
</PageContent>
