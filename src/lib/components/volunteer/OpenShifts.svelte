<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The open shifts board. Each shift is its own row, so a task with two
	 * shifts shows both, and signing up for one leaves the other on the board.
	 *
	 * Every open shift, whatever the member's roles: a shift in a role they
	 * picked carries a badge, and their roles decide which shifts they are
	 * emailed about rather than which they can see (#3239).
	 *
	 * A shift they can't take is shown with the reason rather than hidden: "you
	 * need Sound Desk Cleared" is the useful half of a refusal, and hiding it
	 * just makes the board look empty. Rendering order is the calendar, grouped
	 * by day; interest is the badge, not the sort (#1044).
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { shiftLabel, shiftRoleSuffix } from '#lib/utils/shift-label.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import CardActions from '#lib/components/ui/Card/CardActions.svelte';
	import ShiftSignUpAction from './ShiftSignUpAction.svelte';
	import type { RemoteQueryUpdate } from '$app/server';

	type Shift = {
		id: string;
		workOrderId: string;
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

	let {
		shifts,
		claimUpdates
	}: {
		shifts: Shift[];
		/** The optimistic override for claiming one shift, passed to its sign-up. */
		claimUpdates?: (shiftId: string) => () => RemoteQueryUpdate[];
	} = $props();

	// Shifts they are already on live in the next-action stack beside this, so
	// the board is only ever things they could take on.
	const available = $derived(shifts.filter((s) => !s.myStatus));

	/**
	 * Date order, and a header per day.
	 *
	 * The service orders by interest rank first, so the board used to jump
	 * around in time with nothing to scan by. Interest is still visible as the
	 * badge, but the spine is the calendar (#1044).
	 */
	const byDate = $derived([...available].sort((a, b) => +a.startsAt - +b.startsAt));

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

<InfoCard title={m.volunteer_open_shifts_open_shifts_title()}>
	{#snippet header()}
		<CardTitle>
			{m.volunteer_open_shifts_open_shifts_title()}
			<span class="text-muted font-normal">· {available.length}</span>
		</CardTitle>
	{/snippet}

	{#if available.length === 0}
		<EmptyState title={m.volunteer_open_shifts_nothing_open_right_now_title()} />
	{:else}
		<ul class="divide-y divide-base-300">
			{#each shown as shift, i (shift.id)}
				{@const blocked = blockedReason(shift)}
				{#if startsADay(shown, i)}
					<li class="pt-3 text-xs font-semibold text-base-content/60 uppercase first:pt-0">
						{formatDateShort(shift.startsAt)}
					</li>
				{/if}
				<li
					class="py-3"
					class:opacity-60={blocked}
					data-shift-id={shift.id}
					data-work-order-id={shift.workOrderId}
				>
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-medium">{shiftLabel(shift)}</span>
						{#if shift.interested}
							<Badge variant="info" size="xs" data-testid="your-role"
								>{m.volunteer_open_shifts_your_role_label()}</Badge
							>
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
							? m.volunteer_open_shifts_nobody_yet_text()
							: m.volunteer_open_shifts_filled_text({
									claimed: shift.claimed,
									capacity: shift.capacity
								})}
					</div>

					{#if blocked}
						<p class="mt-2 text-subtle text-sm">{blocked}</p>
					{:else}
						<CardActions class="mt-2">
							<ShiftSignUpAction shiftId={shift.id} {shift} updates={claimUpdates?.(shift.id)} />
						</CardActions>
					{/if}
				</li>
			{/each}
		</ul>

		{#if hidden > 0}
			<Button size="xs" variant="ghost" class="mt-1" onclick={() => (expanded = true)}>
				{m.volunteer_open_shifts_show_more_label({ hidden })}
			</Button>
		{/if}
	{/if}
</InfoCard>
