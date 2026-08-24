<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import { CalendarDate, today as todayIn, getLocalTimeZone } from '@internationalized/date';
	import { IconChevronLeft, IconChevronRight } from '@tabler/icons-svelte';
	import { getPublicCalendar } from '$lib/remote/calendar.remote';
	import { toLocalDate } from '$lib/utils/format';

	let { anchor }: { anchor: string } = $props();

	const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
	const monthNames = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	const tz = getLocalTimeZone();
	const todayStr = todayIn(tz).toString();

	// Displayed month: navigable independently of the anchored day, but snaps
	// back to the anchor's month whenever the anchor changes.
	let nav = $state<{ anchor: string; month: string } | null>(null);
	const month = $derived(nav?.anchor === anchor ? nav.month : anchor.slice(0, 7));

	const data = $derived(await getPublicCalendar({ month }));

	/** Day key → 'cmc' when any CMC event that day, else 'band'. */
	const dayDots = $derived.by(() => {
		const dots: Record<string, 'cmc' | 'band'> = {};
		for (const evt of data.events) {
			const key = toLocalDate(evt.startsAt);
			if (evt.source === 'cmc' || !dots[key]) {
				dots[key] = evt.source === 'cmc' ? 'cmc' : 'band';
			}
		}
		return dots;
	});

	const monthNumber = $derived(Number(month.split('-')[1]));
	const monthLabel = $derived.by(() => {
		const [y, m] = month.split('-').map(Number);
		return `${monthNames[m - 1]} ${y}`;
	});

	function shiftMonth(delta: number) {
		const [y, m] = month.split('-').map(Number);
		const shifted = new Date(Date.UTC(y, m - 1 + delta, 1));
		nav = {
			anchor,
			month: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
		};
	}

	/** Sunday-aligned week rows covering the displayed month (cf. CalendarSelect). */
	const weeks = $derived.by(() => {
		const [y, m] = month.split('-').map(Number);
		const first = new CalendarDate(y, m, 1);
		const last = first.add({ months: 1 }).subtract({ days: 1 });

		let cursor = first.subtract({ days: first.toDate(tz).getDay() });
		const lastDay = last.add({ days: 6 - last.toDate(tz).getDay() });

		const rows: CalendarDate[][] = [];
		while (cursor.compare(lastDay) <= 0) {
			const week: CalendarDate[] = [];
			for (let d = 0; d < 7; d++) {
				week.push(cursor);
				cursor = cursor.add({ days: 1 });
			}
			rows.push(week);
		}
		return rows;
	});
</script>

<div class="mini-cal">
	<div class="mini-cal__head">
		<Button
			type="button"
			variant="ghost"
			size="xs"
			shape="square"
			aria-label="Previous month"
			onclick={() => shiftMonth(-1)}
		>
			<IconChevronLeft size={16} />
		</Button>
		<span class="mini-cal__label">{monthLabel}</span>
		<Button
			type="button"
			variant="ghost"
			size="xs"
			shape="square"
			aria-label="Next month"
			onclick={() => shiftMonth(1)}
		>
			<IconChevronRight size={16} />
		</Button>
	</div>
	<div class="mini-cal__weekdays">
		{#each weekdays as day, i (i)}
			<span>{day}</span>
		{/each}
	</div>
	{#each weeks as week, wi (wi)}
		<div class="mini-cal__row">
			{#each week as date (date.toString())}
				{@const key = date.toString()}
				{@const dot = dayDots[key]}
				<a
					href="/events?from={key}"
					class="mini-cal__day"
					class:mini-cal__day--out={date.month !== monthNumber}
					class:mini-cal__day--today={key === todayStr}
					class:mini-cal__day--anchor={key === anchor}
					aria-label="Jump to {key}"
				>
					{date.day}
					{#if dot}
						<span
							class="mini-cal__dot"
							style="background: var({dot === 'cmc' ? '--cmc-orange' : '--cmc-teal'})"
						></span>
					{/if}
				</a>
			{/each}
		</div>
	{/each}
</div>

<style>
	.mini-cal {
		width: 100%;
		max-width: 17rem;
		border: 1px solid var(--surface-border);
		border-radius: 8px;
		padding: 0.6rem;
	}

	.mini-cal__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.35rem;
	}

	.mini-cal__label {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--cmc-navy);
	}

	.mini-cal__weekdays {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		margin-bottom: 2px;
	}

	.mini-cal__weekdays span {
		text-align: center;
		font-size: 10px;
		font-weight: 600;
		opacity: 0.6;
	}

	.mini-cal__row {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}

	.mini-cal__day {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		font-size: 12px;
		border-radius: 6px;
	}

	.mini-cal__day:hover {
		background: color-mix(in oklch, var(--cmc-navy) 8%, transparent);
	}

	.mini-cal__day--out {
		opacity: 0.35;
	}

	.mini-cal__day--today {
		border: 2px solid var(--cmc-orange);
		font-weight: 700;
	}

	.mini-cal__day--anchor {
		background: color-mix(in oklch, var(--cmc-teal) 18%, transparent);
		font-weight: 700;
	}

	.mini-cal__dot {
		position: absolute;
		bottom: 3px;
		left: 50%;
		transform: translateX(-50%);
		width: 5px;
		height: 5px;
		border-radius: 9999px;
	}
</style>
