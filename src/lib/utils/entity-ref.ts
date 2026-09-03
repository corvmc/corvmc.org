import { positionOrder } from '$lib/config';

/**
 * Deriving the display fields of an `EntityRef` from domain values.
 *
 * Pure, so the rules are unit-testable and usable on both sides of the wire.
 * The server projection (`toMemberRef` and friends) is the intended caller —
 * a ref should arrive at a component already knowing what it is.
 */

/**
 * Which member glyph applies, or `null` for an ordinary member.
 *
 * A position outranks a subscription. Someone can be both, and the position is
 * the one that changes what they can do to the record you are looking at.
 *
 * Every named position other than `admin` wears the staff glyph. Positions are
 * unranked, so there is no "highest" one to render — but "this person is not an
 * ordinary member" is exactly what the badge has always meant, and inventing a
 * glyph per position would put a ranking in the UI that the authorization model
 * deliberately does not have.
 *
 * `position` may still carry a legacy role name (`member`, `sustaining`,
 * `volunteer`); `topPositionFor` filters those out in SQL, and the
 * `positionOrder` test here is what keeps this total if one slips through. The
 * subscription is the source of truth for sustaining status — the old role
 * string outlived it.
 */
export function memberSubtype(
	position: string | null | undefined,
	sustaining: boolean | null | undefined
): 'admin' | 'staff' | 'sustaining' | null {
	if (position === 'admin') return 'admin';
	if (position && (positionOrder as readonly string[]).includes(position)) return 'staff';
	return sustaining ? 'sustaining' : null;
}
