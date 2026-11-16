import { toLocalDate } from '#lib/utils/format.js';
import type { CalendarEntry } from '#lib/types/calendar.js';

const MONTH_NAMES = [
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

function parseYmd(key: string): Date {
	const [y, m, d] = key.split('-').map(Number);
	return new Date(y, m - 1, d);
}

/**
 * Coarse relative sections for the gig list: "This Week" (today..+6 days),
 * "This Month" (rest of the current calendar month), "Looking Ahead" (later).
 * Entries before `today` (a past ?from anchor) group under their month name.
 * Input is sorted by startsAt, so a run-length pass preserves chronological
 * section order.
 */
export function groupGigs(entries: CalendarEntry[], today: string): [string, CalendarEntry[]][] {
	const todayDate = parseYmd(today);
	const groups: [string, CalendarEntry[]][] = [];

	for (const evt of entries) {
		const key = toLocalDate(evt.startsAt);
		let label: string;
		if (key < today) {
			const d = parseYmd(key);
			label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
		} else {
			const diffDays = Math.round((parseYmd(key).getTime() - todayDate.getTime()) / 86_400_000);
			if (diffDays <= 6) label = 'This Week';
			else if (key.slice(0, 7) === today.slice(0, 7)) label = 'This Month';
			else label = 'Looking Ahead';
		}

		const last = groups[groups.length - 1];
		if (last && last[0] === label) last[1].push(evt);
		else groups.push([label, [evt]]);
	}
	return groups;
}
