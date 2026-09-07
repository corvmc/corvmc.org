/**
 * Deriving a member's eligibility from their date of birth.
 *
 * Kept dependency-free so both the server (where the gate is enforced) and a
 * component (where the notice is worded) can ask the same question and get the
 * same answer — the failure mode worth avoiding is a page that says a member is
 * restricted while the query that restricted them disagrees.
 *
 * Absence of a date means "not known to be a minor", never "minor". Most rows
 * carry no date at all, and treating those as restricted would switch messaging
 * off for the whole membership.
 */

/** The age at which the collective's messaging restriction lifts. */
export const ADULT_AGE_YEARS = 18;

/**
 * The birth date on the boundary: anybody born strictly after this instant is
 * under {@link ADULT_AGE_YEARS}.
 *
 * Exported because the messaging gate needs it as a bound parameter inside a
 * raw SQL `EXISTS`, where a JavaScript predicate cannot reach.
 *
 * `setFullYear` on a copy rather than date arithmetic: subtracting 18 × 365 days
 * is wrong across leap years, and the 29th of February resolves the way the rest
 * of the platform's date handling does — to the 1st of March in a common year.
 */
export function adultBirthDateCutoff(now: Date = new Date()): Date {
	const cutoff = new Date(now.getTime());
	cutoff.setFullYear(cutoff.getFullYear() - ADULT_AGE_YEARS);
	return cutoff;
}

/**
 * Whether a member is under {@link ADULT_AGE_YEARS}.
 *
 * Null, undefined and an unparseable date are all "not a minor" — see the
 * module note. Somebody born exactly 18 years ago today is an adult, which is
 * why this is a strict comparison rather than `>=`.
 */
export function isMinor(dateOfBirth: Date | null | undefined, now: Date = new Date()): boolean {
	if (!dateOfBirth) return false;
	const time = dateOfBirth.getTime();
	if (Number.isNaN(time)) return false;
	return time > adultBirthDateCutoff(now).getTime();
}

/**
 * A `YYYY-MM-DD` from a date input as a `Date`, or null.
 *
 * Parsed at UTC midnight so the stored instant does not depend on where the
 * server happens to be. That is immaterial to an eighteen-year comparison
 * except on the birthday itself, where a venue-time reading would be the more
 * defensible one — but the column holds a birth *date*, not a moment, and
 * pinning it to one zone keeps the value the member typed recoverable.
 *
 * Returns null for the empty string (the field cleared, or never filled), for
 * anything unparseable, for a date in the future, and for one implying an age
 * no member has. A bad value is dropped rather than thrown on: this rides along
 * on a profile save, and a typo in an optional field must not cost the member
 * the rest of the form.
 */
export function parseBirthDateInput(
	value: string | null | undefined,
	now = new Date()
): Date | null {
	if (!value) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	const time = parsed.getTime();
	if (Number.isNaN(time)) return null;
	if (time > now.getTime()) return null;
	const oldest = new Date(now.getTime());
	oldest.setUTCFullYear(oldest.getUTCFullYear() - 120);
	if (time < oldest.getTime()) return null;
	return parsed;
}

/** A stored birth date back as `YYYY-MM-DD`, for a date input's value. */
export function toBirthDateInput(d: Date | null | undefined): string {
	if (!d || Number.isNaN(d.getTime())) return '';
	return d.toISOString().slice(0, 10);
}
