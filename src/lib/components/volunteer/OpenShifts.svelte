<script lang="ts">
	/**
	 * The claim board.
	 *
	 * Filtered to the roles the member said they'd take, because that is what
	 * their interests are *for* — a list that ignores them makes picking roles a
	 * form you fill in and never see again. `Show all` is one press away, and the
	 * subline says which of the two you are looking at, since a short list and a
	 * filtered list look identical.
	 *
	 * A shift they can't take is shown with the reason rather than hidden: "you
	 * need Sound Desk Cleared" is the useful half of a refusal, and hiding it
	 * just makes the board look empty. Ordering comes from the service — their
	 * own claims first, then interested roles, then everything else.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { claimShift } from '$lib/remote/volunteer.remote';

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

	let { shifts, hasInterests }: { shifts: Shift[]; hasInterests: boolean } = $props();

	// Shifts they are already on live in the next-action stack beside this, so
	// the board is only ever things they could take on.
	const available = $derived(shifts.filter((s) => !s.myStatus));
	const matches = $derived(available.filter((s) => s.interested));

	let showAll = $state(false);
	// Nothing to filter by is not the same as an empty filter: somebody who has
	// picked no roles should see the whole board rather than an empty one.
	const filtered = $derived(showAll || !hasInterests ? available : matches);

	function timeRange(start: Date, end: Date): string {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(start)}–${fmt.format(end)}`;
	}

	function blockedReason(shift: Shift): string | null {
		if (shift.missingCertifications.length > 0) {
			return `Needs ${shift.missingCertifications.map((c) => c.name).join(' and ')}`;
		}
		if (shift.isFull) return 'Full';
		return null;
	}
</script>

<InfoCard title="Open shifts">
	{#snippet header()}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<CardTitle>
				{showAll || !hasInterests ? 'All open shifts' : 'Open shifts for you'}
			</CardTitle>
			{#if hasInterests && matches.length !== available.length}
				<Button size="xs" variant="ghost" onclick={() => (showAll = !showAll)}>
					{showAll ? `Show matches (${matches.length})` : `Show all ${available.length}`}
				</Button>
			{/if}
		</div>
	{/snippet}

	<p class="text-subtle text-sm">
		{#if !hasInterests}
			Everything that's open. <a href={resolve('/member/volunteer/interests')} class="link">
				Pick the roles you'd take
			</a> and we'll show those first.
		{:else if showAll}
			Everything that's open, whether or not it matches your roles.
		{:else}
			Only the roles you said you'd take.
		{/if}
	</p>

	{#if filtered.length === 0}
		<EmptyState
			title={available.length === 0 ? 'Nothing open right now' : 'Nothing matches your roles'}
			description={available.length === 0
				? 'When staff post shifts, the ones for roles you picked show first.'
				: 'Try every open shift, or add a role to your list.'}
		/>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each filtered as shift (shift.id)}
				{@const blocked = blockedReason(shift)}
				<li class="rounded-lg border border-base-300 p-3" class:opacity-60={blocked}>
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-medium">{shift.roleName}</span>
						{#if shift.interested}
							<Badge variant="info" size="xs">INTERESTED</Badge>
						{/if}
					</div>

					<div class="text-subtle text-sm">
						{formatDateShort(shift.startsAt)} · {timeRange(shift.startsAt, shift.endsAt)}
						{#if shift.eventTitle}
							· {shift.eventTitle}
						{/if}
					</div>

					<!-- "Nobody on it yet" is an ask, not a statistic — it is the line
					     most likely to get somebody to take a shift. -->
					<div class="text-xs {shift.claimed === 0 ? 'text-warning' : 'text-subtle'}">
						{shift.claimed === 0
							? 'nobody on it yet'
							: `${shift.claimed} of ${shift.capacity} filled`}
					</div>

					<div class="mt-2">
						{#if blocked}
							<span class="text-subtle text-sm">{blocked}</span>
						{:else}
							<Action
								action={claimShift.for(shift.id)}
								label="I'll do it"
								variant="primary"
								size="xs"
								modalTitle="Claim this shift?"
								submitLabel="I'll do it"
								successToast="Claimed. Staff confirm next."
							>
								{#snippet form()}
									<input type="hidden" name="shiftId" value={shift.id} />
									<p class="text-sm">
										{shift.roleName}, {formatDateShort(shift.startsAt)},
										{timeRange(shift.startsAt, shift.endsAt)}.
									</p>

									<!-- Three steps, one of them lit. Claiming is not booking, and
									     the gap between them is a person deciding — which is the
									     thing the old copy left the member to find out. -->
									<div class="flex flex-wrap items-center gap-2 text-xs">
										<span class="font-bold text-success">You claim it</span>
										<span class="text-subtle">→</span>
										<span class="text-subtle">Staff confirm</span>
										<span class="text-subtle">→</span>
										<span class="text-subtle">Booked</span>
									</div>

									<p class="text-sm">
										You're not booked until staff confirm, usually within a day. You'll get an email
										then, and a reminder the day before. Drop out any time.
									</p>

									{#if shift.notes}
										<p class="text-muted text-sm">“{shift.notes}”</p>
									{/if}
								{/snippet}
							</Action>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
