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
 * An explicit admin/staff role outranks a subscription. Someone can be both,
 * and staff is the one that changes what they can do to the record you are
 * looking at.
 *
 * `role` may still carry the legacy 'sustaining member' role name, which is
 * ignored in favour of the subscription-derived flag — the subscription is the
 * source of truth for whether someone is currently sustaining, and the old role
 * string outlived it.
 */
export function memberSubtype(
	role: string | null | undefined,
	sustaining: boolean | null | undefined
): 'admin' | 'staff' | 'sustaining' | null {
	if (role === 'admin' || role === 'staff') return role;
	return sustaining ? 'sustaining' : null;
}
