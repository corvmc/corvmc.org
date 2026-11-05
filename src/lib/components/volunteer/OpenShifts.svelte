<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The claim board.
	 *
	 * Filtered to the roles the member said they'd take, because that is what
	 * their interests are *for* — a list that ignores them makes picking roles a
	 * form you fill in and never see again. `Show all` is one press away, and the
	 * heading says which of the two you are looking at, since a short list and a
	 * filtered list look identical.
	 *
	 * A shift they can't take is shown with the reason rather than hidden: "you
	 * need Sound Desk Cleared" is the useful half of a refusal, and hiding it
	 * just makes the board look empty. Rendering order is the calendar, grouped
	 * by day; interest is the badge and the filter, not the sort (#1044).
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { shiftLabel, shiftRoleSuffix } from '#lib/utils/shift-label.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import { claimShift } from '#lib/remote/volunteer.remote.js';

	type Shift = {
		id: string;
		roleName: string;
		title?: string | null;
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

	/**
	 * Date order, and a header per day.
	 *
	 * The service orders by interest rank first, so the board used to jump
	 * around in time with nothing to scan by. Interest is still visible — it is
	 * the badge and the default filter — but the spine is the calendar (#1044).
	 */
	const byDate = $derived([...filtered].sort((a, b) => +a.startsAt - +b.startsAt));

	/** One screenful. The service caps at 50, which is ~5,500px in this column. */
	const PREVIEW = 6;
	let expanded = $state(false);
	const shown = $derived(expanded ? byDate : byDate.slice(0, PREVIEW));
	const hidden = $derived(byDate.length - shown.length);

	/** A day header only where the day changes. */
	function startsADay(list: Shift[], i: number): boolean {
		if (i === 0) return true;
		return formatDateShort(list[i].startsAt) !== formatDateShort(list[i - 1].startsAt);
	}

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

<InfoCard title={m.volunteer_open_shifts_open_shifts()}>
	{#snippet header()}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<CardTitle>
				{showAll || !hasInterests
					? m.volunteer_open_shifts_open_shifts()
					: m.volunteer_open_shifts_open_shifts_2()}
				<span class="text-muted font-normal">· {filtered.length}</span>
			</CardTitle>
			{#if hasInterests && matches.length !== available.length}
				<Button size="xs" variant="ghost" onclick={() => (showAll = !showAll)}>
					{showAll
						? m.volunteer_open_shifts_show_matches({ length: matches.length })
						: m.volunteer_open_shifts_show_all({ length: available.length })}
				</Button>
			{/if}
		</div>
	{/snippet}

	{#if filtered.length === 0}
		<EmptyState
			title={available.length === 0
				? m.volunteer_open_shifts_nothing_open_right_now()
				: m.volunteer_open_shifts_nothing_matches_roles()}
			description={available.length === 0
				? m.volunteer_open_shifts_when_staff_post_shifts_ones()
				: m.volunteer_open_shifts_try_every_open_shift_add()}
		/>
	{:else}
		<ul class="divide-y divide-base-300">
			{#each shown as shift, i (shift.id)}
				{@const blocked = blockedReason(shift)}
				{#if startsADay(shown, i)}
					<li class="pt-3 text-xs font-semibold text-base-content/60 uppercase first:pt-0">
						{formatDateShort(shift.startsAt)}
					</li>
				{/if}
				<li class="py-3" class:opacity-60={blocked} data-shift-id={shift.id}>
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-medium">{shiftLabel(shift)}</span>
						{#if shift.interested}
							<Badge variant="info" size="xs">{m.volunteer_open_shifts_interested()}</Badge>
						{/if}
					</div>

					<div class="text-subtle text-sm">
						{timeRange(shift.startsAt, shift.endsAt)}
						{#if shiftRoleSuffix(shift)}
							· {shiftRoleSuffix(shift)}
						{/if}
					</div>

					<!-- "Nobody on it yet" is an ask, not a statistic — it is the line
					     most likely to get somebody to take a shift. -->
					<div class="text-xs {shift.claimed === 0 ? 'text-warning' : 'text-subtle'}">
						{shift.claimed === 0
							? m.volunteer_open_shifts_nobody_yet()
							: m.volunteer_open_shifts_filled({
									claimed: shift.claimed,
									capacity: shift.capacity
								})}
					</div>

					<div class="mt-2">
						{#if blocked}
							<span class="text-subtle text-sm">{blocked}</span>
						{:else}
							<Action
								action={claimShift.for(shift.id)}
								label={m.volunteer_open_shifts_label()}
								variant="primary"
								size="xs"
								modalTitle={m.volunteer_open_shifts_modal_title()}
								submitLabel={m.volunteer_open_shifts_label()}
								successToast={m.volunteer_open_shifts_success_toast()}
							>
								{#snippet form()}
									<input {...claimShift.for(shift.id).fields.shiftId.as('hidden', shift.id)} />
									<p class="text-sm">
										{shiftLabel(shift)}, {formatDateShort(shift.startsAt)},
										{timeRange(shift.startsAt, shift.endsAt)}.
									</p>

									<!-- Three steps, one of them lit. Claiming is not booking, and
									     the gap between them is a person deciding — which is the
									     thing the old copy left the member to find out. -->
									<div class="flex flex-wrap items-center gap-2 text-xs">
										<span class="font-bold text-success">{m.volunteer_open_shifts_claim()}</span>
										<span class="text-subtle">→</span>
										<span class="text-subtle">{m.volunteer_open_shifts_staff_confirm()}</span>
										<span class="text-subtle">→</span>
										<span class="text-subtle">{m.volunteer_booked()}</span>
									</div>

									<p class="text-sm">
										{m.volunteer_open_shifts_re_not_booked_until_staff()}
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

		{#if hidden > 0}
			<Button size="xs" variant="ghost" class="mt-1" onclick={() => (expanded = true)}>
				{m.volunteer_open_shifts_show_more({ hidden })}
			</Button>
		{/if}
	{/if}
</InfoCard>
