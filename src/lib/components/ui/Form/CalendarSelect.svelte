<script lang="ts">
	import { today, getLocalTimeZone, parseDate, type DateValue } from '@internationalized/date';

	let {
		value = $bindable(''),
		name,
		isDateUnavailable,
		minValue,
		maxValue,
		disabled = false
	}: {
		value?: string;
		name: string;
		isDateUnavailable?: (date: DateValue) => boolean;
		minValue?: DateValue;
		maxValue?: DateValue;
		disabled?: boolean;
	} = $props();

	const tz = getLocalTimeZone();
	const weekdays = [
		{ short: 'Su', long: 'Sunday' },
		{ short: 'Mo', long: 'Monday' },
		{ short: 'Tu', long: 'Tuesday' },
		{ short: 'We', long: 'Wednesday' },
		{ short: 'Th', long: 'Thursday' },
		{ short: 'Fr', long: 'Friday' },
		{ short: 'Sa', long: 'Saturday' }
	];
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
	const todayValue = today(tz);
	const dateLabel = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	});

	/** Build the rows of DateValues from the Sunday of minValue's week through the Saturday of maxValue's week. */
	const weeks = $derived.by(() => {
		const start = minValue ?? todayValue;
		const end = maxValue ?? start.add({ days: 14 });

		// Rewind to Sunday
		let cursor = start.subtract({ days: start.toDate(tz).getDay() });
		// Advance to Saturday past end
		const lastDay = end.add({ days: 6 - end.toDate(tz).getDay() });

		const rows: DateValue[][] = [];
		while (cursor.compare(lastDay) <= 0) {
			const week: DateValue[] = [];
			for (let d = 0; d < 7; d++) {
				week.push(cursor);
				cursor = cursor.add({ days: 1 });
			}
			rows.push(week);
		}
		return rows;
	});

	const heading = $derived.by(() => {
		if (weeks.length === 0) return '';
		const first = weeks[0][0];
		const last = weeks[weeks.length - 1][6];
		const firstMonth = monthNames[first.month - 1];
		if (first.month === last.month) return firstMonth;
		return `${firstMonth} – ${monthNames[last.month - 1]}`;
	});

	function isOutOfRange(d: DateValue): boolean {
		if (minValue && d.compare(minValue) < 0) return true;
		if (maxValue && d.compare(maxValue) > 0) return true;
		return false;
	}

	function isDisabled(d: DateValue): boolean {
		if (disabled) return true;
		if (isOutOfRange(d)) return true;
		if (isDateUnavailable?.(d)) return true;
		return false;
	}

	function select(d: DateValue) {
		if (isDisabled(d)) return;
		value = d.toString();
	}

	// The whole grid is one tab stop, and the arrows move within it. Every date
	// being its own tab stop cost 13 presses to cross the calendar, and the
	// arrow keys did nothing at all.
	const dates = $derived(weeks.flat());
	const defaultFocusIso = $derived(
		value || dates.find((d) => !isDisabled(d))?.toString() || dates[0]?.toString() || ''
	);
	let focusIso = $state('');
	const tabbableIso = $derived(focusIso || defaultFocusIso);

	let gridEl: HTMLDivElement | undefined = $state();

	function moveFocus(next: DateValue) {
		const iso = next.toString();
		// Never past the rendered range: there is no next month to page into.
		if (!dates.some((d) => d.toString() === iso)) return;
		focusIso = iso;
		gridEl?.querySelector<HTMLElement>(`[data-date="${iso}"]`)?.focus();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (!tabbableIso) return;
		const current = parseDate(tabbableIso);
		const weekday = current.toDate(tz).getDay();
		let next: DateValue;

		switch (event.key) {
			case 'ArrowLeft':
				next = current.subtract({ days: 1 });
				break;
			case 'ArrowRight':
				next = current.add({ days: 1 });
				break;
			case 'ArrowUp':
				next = current.subtract({ days: 7 });
				break;
			case 'ArrowDown':
				next = current.add({ days: 7 });
				break;
			case 'Home':
				next = current.subtract({ days: weekday });
				break;
			case 'End':
				next = current.add({ days: 6 - weekday });
				break;
			default:
				return;
		}

		event.preventDefault();
		moveFocus(next);
	}

	/**
	 * The full date, and why a date cannot be picked. Colour and a strike-through
	 * carried both facts before, so a non-visual user heard "9, button".
	 */
	function cellLabel(d: DateValue): string {
		const base = dateLabel.format(d.toDate(tz));
		if (disabled) return base;
		if (isOutOfRange(d)) return `${base}, outside the booking window`;
		if (isDateUnavailable?.(d)) return `${base}, unavailable`;
		return base;
	}

	function cellClass(d: DateValue): string {
		const str = d.toString();
		const selected = str === value;
		const outOfRange = isOutOfRange(d);
		const unavailable = !outOfRange && isDateUnavailable?.(d);
		const isToday = d.compare(todayValue) === 0;
		const base =
			'flex aspect-square w-full items-center justify-center rounded-md text-xs transition-colors';

		if (selected)
			return `${base} cursor-pointer bg-primary text-primary-content border border-primary`;
		if (outOfRange) return `${base} cursor-not-allowed opacity-30`;
		if (unavailable) return `${base} cursor-not-allowed text-error line-through opacity-40`;
		if (isToday)
			return `${base} cursor-pointer border-2 border-primary font-semibold hover:bg-base-200`;
		return `${base} cursor-pointer border border-base-300 hover:bg-base-200`;
	}
</script>

<!-- Full width on a phone: seven cells inside `max-w-64` measure 32.6px, and a
     mis-tap there silently books a different day. -->
<div class="mx-auto w-full sm:max-w-64">
	<p id="{name}-heading" class="pb-2 text-center text-xs font-medium">{heading}</p>
	<div
		bind:this={gridEl}
		role="grid"
		aria-labelledby="{name}-heading"
		onkeydown={onKeyDown}
		tabindex="-1"
	>
		<div class="grid grid-cols-7 pb-1" role="row">
			{#each weekdays as day (day.long)}
				<span role="columnheader" aria-label={day.long} class="text-center text-subtle font-medium">
					{day.short}
				</span>
			{/each}
		</div>
		{#each weeks as week, wi (wi)}
			<div class="grid grid-cols-7" role="row">
				{#each week as date (date.toString())}
					<div class="p-0.5" role="gridcell" aria-selected={date.toString() === value}>
						<!-- `aria-disabled`, not `disabled`: an unpickable date stays reachable
						     so its label can say why it is unpickable. `select()` is the guard. -->
						<button
							type="button"
							data-date={date.toString()}
							class={cellClass(date)}
							aria-label={cellLabel(date)}
							aria-disabled={isDisabled(date)}
							aria-current={date.compare(todayValue) === 0 ? 'date' : undefined}
							tabindex={date.toString() === tabbableIso ? 0 : -1}
							onclick={() => select(date)}
							onfocus={() => (focusIso = date.toString())}
						>
							{date.day}
						</button>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>
<input type="date" {name} {value} hidden />
