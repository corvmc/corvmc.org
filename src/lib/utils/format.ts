/**
 * Shared date, time, and currency formatting utilities.
 *
 * **Everything here renders in venue time (`DEFAULT_TIMEZONE`), not the
 * viewer's zone.** This is a location-based application: a 7pm booking is 7pm
 * at the door whether the member reads the page from the practice room or from
 * a tour stop three time zones away. It also keeps SSR and post-hydration
 * output identical, which a viewer-local format cannot do.
 *
 * That is why these functions build strings from `Intl.DateTimeFormat` with an
 * explicit `timeZone` rather than from `date-fns`'s `format()`, which has no
 * concept of zones and silently uses whatever the runtime is set to.
 *
 * Formatting an instant in a named zone is the *only* correct way to do this.
 * Do not "simplify" it by converting to a local `Date` first and formatting
 * that — the venue wall-clock can land in the viewer's DST gap, which shifts
 * the rendered hour with no error.
 */

import { differenceInCalendarDays } from 'date-fns';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// Venue-time primitives
// ---------------------------------------------------------------------------

/**
 * `Intl.DateTimeFormat` construction is expensive enough to matter in a list
 * that formats a few hundred cells, and these option bags are fixed, so build
 * each formatter once.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function venueFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale}|${JSON.stringify(options)}`;
	let fmt = formatterCache.get(key);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat(locale, { timeZone: DEFAULT_TIMEZONE, ...options });
		formatterCache.set(key, fmt);
	}
	return fmt;
}

/**
 * Newer ICU versions separate the time from AM/PM with U+202F (narrow no-break
 * space) instead of a plain space. Workers, CI, and a developer laptop can each
 * ship a different ICU, so normalise it — otherwise the same code renders two
 * different strings and every snapshot assertion becomes environment-dependent.
 */
function normaliseSpaces(value: string): string {
	return value.replace(/[\u202f\u00a0]/g, ' ');
}

function venue(d: Date, options: Intl.DateTimeFormatOptions, locale = 'en-US'): string {
	return normaliseSpaces(venueFormatter(locale, options).format(d));
}

/** Calendar parts of an instant *in venue time*. */
function venueParts(d: Date): { year: number; month: number; day: number } {
	const parts = Object.fromEntries(
		venueFormatter('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
			.formatToParts(d)
			.map((p) => [p.type, p.value])
	);
	return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/**
 * A `Date` whose *local* fields equal this instant's venue calendar date, for
 * handing to date-fns helpers that only do calendar arithmetic (never
 * formatting). Time is zeroed, so the DST-gap hazard described above cannot
 * apply.
 */
function venueCalendarDate(d: Date): Date {
	const { year, month, day } = venueParts(d);
	return new Date(year, month - 1, day);
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/** Short date: "Tue, May 13" */
export function formatDate(d: Date): string {
	return venue(d, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Short date with year: "Tue, May 13, 2026" */
export function formatDateYear(d: Date): string {
	return venue(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Relative day label: "Today", "Tomorrow", "Next Wednesday", "in 3 weeks", "2 months ago" */
export function relativeDay(d: Date): string {
	// Compare venue calendar days, not viewer calendar days — otherwise a
	// booking reads "Tomorrow" to a member whose own midnight has passed but
	// the venue's has not.
	const now = venueCalendarDate(new Date());
	const target = venueCalendarDate(d);
	const diffDays = differenceInCalendarDays(target, now);

	if (diffDays === 0) return 'Today';
	if (diffDays === 1) return 'Tomorrow';
	if (diffDays === -1) return 'Yesterday';

	const dayName = venue(d, { weekday: 'long' });
	if (diffDays > 1 && diffDays <= 7) return `This ${dayName}`;
	if (diffDays > 7 && diffDays <= 14) return `Next ${dayName}`;
	if (diffDays < -1 && diffDays >= -7) return `Last ${dayName}`;

	const absDays = Math.abs(diffDays);
	const weeks = Math.round(absDays / 7);
	const months = Math.round(absDays / 30);

	if (absDays < 30) {
		const label = weeks === 1 ? '1 week' : `${weeks} weeks`;
		return diffDays > 0 ? `In ${label}` : `${label} ago`;
	}
	const label = months === 1 ? '1 month' : `${months} months`;
	return diffDays > 0 ? `In ${label}` : `${label} ago`;
}

/** Long date: "Tuesday, May 13, 2026" */
export function fullDate(d: Date): string {
	return venue(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Long date without the year: "Friday, July 3".
 *
 * For a record the reader is already looking at — a reservation detail page —
 * where the year is implied by context and `fullDate`'s trailing ", 2026" is
 * just noise.
 */
export function formatDateLong(d: Date): string {
	return venue(d, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Short uppercase weekday: "SAT" */
export function formatDayOfWeek(d: Date): string {
	return venue(d, { weekday: 'short' }).toUpperCase();
}

/** Day of month number: "23" */
export function formatDayNumber(d: Date): string {
	return venue(d, { day: 'numeric' });
}

/** Short uppercase month: "MAY" */
export function formatShortMonth(d: Date): string {
	return venue(d, { month: 'short' }).toUpperCase();
}

/** Date + time combined: "Tue, May 13, 2:30 PM" */
export function formatDateTime(d: Date): string {
	return venue(d, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
}

/**
 * List-cell date: "May 13".
 *
 * The weekday is noise in a date-sorted list and it is what makes date cells
 * wrap on narrow screens. Keep `formatDate` for detail pages and group headers,
 * where the weekday earns its space.
 */
export function formatDateShort(d: Date): string {
	return venue(d, { month: 'short', day: 'numeric' });
}

/** List-cell date + time: "May 13, 2:30 PM" */
export function formatDateTimeShort(d: Date): string {
	return venue(d, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
}

/**
 * Humanise a snake_case enum value: `admin_adjustment` → "Admin adjustment".
 *
 * The fallback for every enum→label map, so a value someone forgets to add
 * still reads as English rather than leaking the raw database token.
 */
export function titleCase(value: string): string {
	const s = value.replace(/_/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Up to two initials from a name: "Jordan Martinez" → "JM".
 *
 * Guards against empty segments — a trailing space or a double space would
 * otherwise make `p[0]` undefined and render the literal "UNDEFINED".
 */
export function initials(name: string): string {
	return name
		.split(' ')
		.filter(Boolean)
		.map((p) => p[0])
		.slice(0, 2)
		.join('')
		.toUpperCase();
}

/**
 * List-cell date with year: "May 13, 2026".
 *
 * For durable facts — a join date, a created-at — where a bare "Dec 22" is
 * ambiguous once the list spans more than one year.
 */
export function formatDateShortYear(d: Date): string {
	return venue(d, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/** Time only: "2:30 PM" */
export function formatTime(d: Date): string {
	return venue(d, { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Time range: "2:30 PM – 5:00 PM" */
export function formatTimeRange(startsAt: Date, endsAt: Date): string {
	return `${formatTime(startsAt)} – ${formatTime(endsAt)}`;
}

/** Date → local date string for date inputs: "2026-05-13" */
export function toLocalDate(d: Date): string {
	return venue(d, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA');
}

/** Date → local 24h time for time inputs: "14:30" */
export function toLocalTime(d: Date): string {
	return venue(d, { hour: '2-digit', minute: '2-digit', hour12: false }, 'en-GB');
}

/**
 * Date → the value a `<input type="datetime-local">` wants: "2026-05-13T14:30".
 *
 * In *venue* time, which is the whole point. A datetime-local input has no
 * timezone, so whatever wall clock this produces is the wall clock the server
 * parses back — and the server parses in club time.
 */
export function toLocalDateTime(d: Date): string {
	return `${toLocalDate(d)}T${toLocalTime(d)}`;
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/** Duration between two timestamps in decimal hours. */
export function durationHours(startsAt: Date, endsAt: Date): number {
	return (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60);
}

/** Human-readable duration: "1 hour" or "2.5 hours" */
export function formatDuration(startsAt: Date, endsAt: Date): string {
	const h = durationHours(startsAt, endsAt);
	return `${h} hour${h === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/** Format cents as dollars: 1500 → "$15.00" */
export function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** Format cents as dollars without symbol: 1500 → "15.00" */
export function formatDollars(cents: number): string {
	return (cents / 100).toFixed(2);
}

/** Calculate amount from duration and rate, formatted: "$30.00" */
export function formatDurationAmount(
	startsAt: Date,
	endsAt: Date,
	hourlyRateCents: number
): string {
	const hours = durationHours(startsAt, endsAt);
	const cents = Math.round(hours * hourlyRateCents);
	return formatCents(cents);
}

/** "2 hrs · $24.50" */
export function formatDurationAndAmount(
	startsAt: Date,
	endsAt: Date,
	hourlyRateCents: number
): string {
	const h = durationHours(startsAt, endsAt);
	const label = h === 1 ? '1 hr' : `${h} hrs`;
	return `${label} · ${formatDurationAmount(startsAt, endsAt, hourlyRateCents)}`;
}

/**
 * Split a reservation's list price into the cash half and the credit half.
 *
 * `reservation.creditsUsed` is stored in hours, and one credit buys one hour in
 * every member-facing surface, so that column is simultaneously the credit
 * count and the hours those credits cover. Fractional values are expected — the
 * venue books in 30-minute blocks, so half credits are normal, not a rounding
 * artifact. Do not convert through `hoursToCredits()`: the 30-minute block is a
 * data-layer denomination that the UI never shows.
 *
 * The cash half is derived by subtraction rather than read from `cashDueCents`
 * because that column is a settlement marker, not an amount — it drops to 0
 * once a booking is paid, which would render every settled reservation as free.
 */
export function reservationPaymentBreakdown(
	startsAt: Date,
	endsAt: Date,
	hourlyRateCents: number,
	creditsUsed: number | null
): { cashCents: number; credits: number } {
	const totalCents = Math.round(durationHours(startsAt, endsAt) * hourlyRateCents);
	const credits = Math.max(0, creditsUsed ?? 0);
	const creditCents = Math.min(Math.round(credits * hourlyRateCents), totalCents);
	return { cashCents: totalCents - creditCents, credits };
}

/** Trim a credit count for display: 1.5 → "1.5", 2 → "2" */
function creditLabel(credits: number): string {
	return String(Number(credits.toFixed(2)));
}

/**
 * A reservation's payment as "$15.00, 1.5cr", dropping whichever half is zero.
 * A booking with no credits reads "$37.50"; one covered entirely by credits
 * reads "2.5cr".
 */
export function formatPaymentBreakdown(
	startsAt: Date,
	endsAt: Date,
	hourlyRateCents: number,
	creditsUsed: number | null
): string {
	const { cashCents, credits } = reservationPaymentBreakdown(
		startsAt,
		endsAt,
		hourlyRateCents,
		creditsUsed
	);
	const parts: string[] = [];
	// Keep $0.00 when there are no credits either, so the cell is never empty.
	if (cashCents > 0 || credits === 0) parts.push(formatCents(cashCents));
	if (credits > 0) parts.push(`${creditLabel(credits)}cr`);
	return parts.join(', ');
}

/** "May 3, 2026" — month, day, year without weekday */
export function formatMonthDayYear(d: Date): string {
	return venue(d, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Ordinal suffix for a number: 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
function ordinalNumber(n: number): string {
	const mod100 = n % 100;
	if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
	switch (n % 10) {
		case 1:
			return `${n}st`;
		case 2:
			return `${n}nd`;
		case 3:
			return `${n}rd`;
		default:
			return `${n}th`;
	}
}

/** "Every Sunday", "Every other Tuesday", "1st Saturday of each month", "On the 20th of each month" */
export function formatScheduleLabel(
	frequencyLabel: string,
	startsAt: Date,
	monthlyMode: 'weekday' | 'monthday' | null = 'weekday'
): string {
	const dayName = venue(startsAt, { weekday: 'long' });

	if (frequencyLabel === 'Weekly') return `Every ${dayName}`;
	if (frequencyLabel === 'Every 2 weeks') return `Every other ${dayName}`;
	if (frequencyLabel === 'Monthly') {
		const dayOfMonth = venueParts(startsAt).day;
		if (monthlyMode === 'monthday') {
			return `On the ${ordinalNumber(dayOfMonth)} of each month`;
		}
		const nth = Math.ceil(dayOfMonth / 7);
		return `${ordinalNumber(nth)} ${dayName} of each month`;
	}

	return frequencyLabel;
}

/** Convert HH:MM slot time to display: "14:30" → "2:30 PM" */
export function formatSlotTime(time: string): string {
	const [h, m] = time.split(':').map(Number);
	const suffix = h >= 12 ? 'PM' : 'AM';
	const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
	return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`;
}
