<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		formatWeekdayShortCased,
		formatDayNumber,
		formatMonthShortCased,
		isVenueToday,
		isVenueTomorrow,
		isVenueThisWeek
	} from '$lib/utils/format';
	import { isTerminalStatus } from '$lib/utils/reservation-actions';

	/**
	 * A booking as a card: tear-off date block tinted by status, the status word,
	 * and a body the panel supplies.
	 *
	 * The band panel drew the same record as a plain row with a badge while the
	 * member panel drew this (#566), so one booking read as two objects depending
	 * on where you stood. The identity and the date block are what converge; the
	 * action row deliberately does not, because what a band member may do with a
	 * booking made on the act's behalf is not what its booker may do.
	 */
	let {
		startsAt,
		status,
		children,
		actions
	}: {
		startsAt: Date;
		status: string;
		children: Snippet;
		/** Sits on the bottom border, right-aligned. Omit for a card with no controls. */
		actions?: Snippet;
	} = $props();

	const terminal = $derived(isTerminalStatus(status));
</script>

<!-- `reservation-card` is the handle the e2e locates a booking by; it replaced
     daisyUI's `.card`, which the band panel used only because it was wrapped in
     a `Card` and the member panel never had. -->
<div
	class="reservation-card relative my-2 flex rounded-md border-[2.5px] border-(--cmc-brown) bg-base-100 {status}"
>
	<div class="date-block">
		{#if !terminal && isVenueThisWeek(startsAt)}
			<span class="upcoming-tag">
				{#if isVenueToday(startsAt)}
					Today
				{:else if isVenueTomorrow(startsAt)}
					Tomorrow
				{:else}
					This Week
				{/if}
			</span>
		{/if}
		<span>{formatWeekdayShortCased(startsAt)}</span>
		<span class="text-3xl">{formatDayNumber(startsAt)}</span>
		<span>{formatMonthShortCased(startsAt)}</span>
	</div>
	<div class="flex min-w-0 flex-1 flex-col">
		{@render children()}
		<span class="reservation-status">{status.replace('_', ' ')}</span>
		{#if actions}
			<!-- Zero-height on purpose: the row straddles the bottom border. -->
			<div class="mt-5 flex h-0 items-center justify-end gap-2 px-2">
				{@render actions()}
			</div>
		{/if}
	</div>
</div>

<style lang="postcss">
	@reference '#/routes/layout.css';

	.upcoming-tag {
		@apply absolute -top-3 left-0 ml-[-2.5px] rounded-sm rounded-bl-none border-[2.5px] border-(--cmc-brown) bg-error px-1 text-[.6rem] font-bold tracking-wide text-error-content uppercase;
	}

	.date-block {
		@apply relative flex w-20 shrink-0 flex-col items-center justify-center rounded-l-sm border-r-2 border-(--cmc-brown) py-3 text-xs leading-tight font-bold;
	}

	.confirmed .date-block {
		@apply bg-secondary text-secondary-content;
	}

	.scheduled .date-block {
		@apply bg-warning text-warning-content;
	}

	.completed .date-block {
		@apply bg-success text-success-content;
	}

	/* Class comes from the raw status value, so underscore — not hyphen. */
	.no_show .date-block {
		@apply bg-base-300 text-error;
	}

	.cancelled .date-block {
		@apply bg-base-300 text-base-content/50;
	}

	.reservation-status {
		@apply absolute top-2 right-2 text-xs font-bold tracking-wide uppercase opacity-50;
		font-family: var(--font-mono);
	}
</style>
