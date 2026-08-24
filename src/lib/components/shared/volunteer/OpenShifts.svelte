<script lang="ts">
	/**
	 * The member's shift board.
	 *
	 * A shift they can't take is shown with the reason rather than hidden — "you
	 * need Sound Desk Cleared" is the useful half of a refusal, and hiding it just
	 * makes the board look empty. Ordering comes from the service: their own
	 * claims first, then roles they've said they're interested in, then everything else.
	 */
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import { formatDateShort, formatDateTimeShort } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { claimShift, cancelMySignup } from '$lib/remote/volunteer.remote';

	type Shift = {
		id: string;
		roleName: string;
		startsAt: Date;
		endsAt: Date;
		capacity: number;
		claimed: number;
		notes: string | null;
		eventTitle: string | null;
		myStatus: string | null;
		mySignupId: string | null;
		isFull: boolean;
		interested: boolean;
		missingCertifications: { id: string; name: string }[];
	};

	let { shifts }: { shifts: Shift[] } = $props();

	function timeRange(start: Date, end: Date): string {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(start)}–${fmt.format(end)}`;
	}

	function blockedReason(shift: Shift): string | null {
		if (shift.myStatus) return null;
		if (shift.missingCertifications.length > 0) {
			return `Needs ${shift.missingCertifications.map((c) => c.name).join(' and ')}`;
		}
		if (shift.isFull) return 'Full';
		return null;
	}
</script>

<InfoCard title="Shifts you can pick up">
	{#if shifts.length === 0}
		<EmptyState
			title="Nothing scheduled yet"
			description="When staff post shifts, the ones for roles you picked show first."
		/>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each shifts as shift (shift.id)}
				{@const blocked = blockedReason(shift)}
				<li
					class="flex flex-wrap items-start justify-between gap-3 rounded-box bg-base-200 p-3"
					class:opacity-60={blocked}
				>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium">{shift.roleName}</span>
							{#if shift.myStatus}
								<span
									class="badge badge-sm {shift.myStatus === 'confirmed'
										? 'badge-success'
										: 'badge-info'}"
								>
									{shift.myStatus === 'confirmed' ? "you're on" : 'claimed'}
								</span>
							{:else if shift.interested}
								<span class="badge badge-ghost badge-sm">you're interested</span>
							{/if}
						</div>

						<div class="text-muted">
							{formatDateShort(shift.startsAt)} · {timeRange(shift.startsAt, shift.endsAt)}
							{#if shift.eventTitle}
								· {shift.eventTitle}
							{/if}
						</div>

						{#if shift.notes}
							<div class="text-subtle">{shift.notes}</div>
						{/if}

						<div class="text-subtle">
							{shift.claimed} of {shift.capacity} filled
						</div>
					</div>

					<div class="flex shrink-0 items-center gap-2">
						{#if blocked}
							<span class="text-subtle">{blocked}</span>
						{:else if shift.myStatus && shift.mySignupId}
							<Action
								action={cancelMySignup.for(shift.id)}
								label="Drop out"
								variant="ghost"
								size="xs"
								modalTitle="Drop this shift?"
								submitLabel="Drop out"
								successToast="You're off the shift"
							>
								{#snippet form()}
									<input type="hidden" name="signupId" value={shift.mySignupId} />
									<p class="text-sm">
										{shift.roleName} on {formatDateTimeShort(shift.startsAt)}. Your place opens up
										for somebody else straight away.
									</p>
								{/snippet}
							</Action>
						{:else if !shift.myStatus}
							<Action
								action={claimShift.for(shift.id)}
								label="I'll do it"
								variant="primary"
								size="sm"
								modalTitle="Claim this shift?"
								submitLabel="Claim it"
								successToast="Claimed — staff will confirm"
							>
								{#snippet form()}
									<input type="hidden" name="shiftId" value={shift.id} />
									<p class="text-sm">
										{shift.roleName}, {formatDateShort(shift.startsAt)},
										{timeRange(shift.startsAt, shift.endsAt)}.
									</p>
									{#if shift.notes}
										<p class="text-muted">{shift.notes}</p>
									{/if}
									<p class="text-muted">
										Staff confirm claims. You'll get a reminder the day before, and you can drop out
										from this page if something comes up.
									</p>
								{/snippet}
							</Action>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
