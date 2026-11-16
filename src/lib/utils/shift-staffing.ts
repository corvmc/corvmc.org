/**
 * A shift's staffing, as the Volunteering page's chips and the nav badge read
 * it (#2625). One definition, so the badge can only count rows a chip lists.
 * Client-safe: no server imports.
 */

interface Staffing {
	capacity: number;
	/** Places taken: claimed, confirmed or completed. */
	claimed: number;
	/** Places booked: confirmed or completed. Only a booking gets the reminder. */
	confirmed: number;
}

/** Fewer places booked than the shift has. Unconfirmed claims do not staff it. */
export const isShortStaffed = (s: Staffing) => s.confirmed < s.capacity;

/** Somebody has claimed a place that nobody has confirmed yet. */
export const hasClaimsToConfirm = (s: Staffing) => s.claimed > s.confirmed;

/** How far ahead the badge looks for short-staffed shifts. */
export const SHORT_STAFFED_BADGE_DAYS = 7;
