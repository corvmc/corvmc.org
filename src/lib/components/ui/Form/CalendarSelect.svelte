<script lang="ts">
	import { today, getLocalTimeZone, type DateValue } from '@internationalized/date';

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
	const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
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
		if (outOfRange) return `${base} opacity-30`;
		if (unavailable) return `${base} text-error line-through opacity-40`;
		if (isToday)
			return `${base} cursor-pointer border-2 border-primary font-semibold hover:bg-base-200`;
		return `${base} cursor-pointer border border-base-300 hover:bg-base-200`;
	}
</script>

<div class="mx-auto w-full max-w-64">
	<p class="pb-2 text-center text-xs font-medium">{heading}</p>
	<div class="grid grid-cols-7 pb-1">
		{#each weekdays as day, i (i)}
			<span class="text-center text-subtle font-medium">{day}</span>
		{/each}
	</div>
	{#each weeks as week, wi (wi)}
		<div class="grid grid-cols-7">
			{#each week as date (date.toString())}
				<div class="p-0.5">
					<button
						type="button"
						class={cellClass(date)}
						disabled={isDisabled(date)}
						onclick={() => select(date)}
					>
						{date.day}
					</button>
				</div>
			{/each}
		</div>
	{/each}
</div>
<input type="date" {name} {value} hidden />
