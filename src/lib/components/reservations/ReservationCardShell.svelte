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
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';

	/**
	 * A booking as a card: date block tinted by status, the status, and a body
	 * the panel supplies.
	 *
	 * The identity and the date block are what the two panels share (#566). The
	 * action row is not: what a bandmate may do with a booking made on the act's
	 * behalf is not what its booker may do.
	 *
	 * Two channels for status, deliberately: the tint reads at a glance and
	 * names nothing, `StatusBadge` is the app's shared vocabulary. The bespoke
	 * mono word this replaced was a third, and it overlapped the text (#1043).
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
<!-- No margin of its own: the list or grid that holds it sets the gutter, and
     `my-2` inside a `gap-2` grid made a 24px one and stopped the card filling
     its stretched cell, so borders did not line up across a row (#1043). -->
<div
	class="reservation-card relative flex h-full rounded-md border-[2.5px] border-(--cmc-brown) bg-base-100 {status}"
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
		<!-- In flow beside the body, not floating over it: absolutely positioned
		     with no reserved gutter the body's text ran under it, and reserving
		     one wrapped every line at a single column (#1043). -->
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0 flex-1">{@render children()}</div>
			<span class="shrink-0 pt-2 pr-2"><StatusBadge {status} label size={14} /></span>
		</div>
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
</style>
