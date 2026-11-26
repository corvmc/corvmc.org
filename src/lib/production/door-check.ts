/**
 * Where a show's door cash counts stand (#3273). Pure, so the settlement, the
 * console and the close warning read the same answer.
 *
 * The handoffs' sum is what the till held as it changed hands; the staff count
 * is the last word. `none` is a show nobody has counted, which is not a
 * warning. `single` is one kind of count only, with nothing to check it against.
 */
export type DoorCheck = 'none' | 'single' | 'agreed' | 'mismatch';

export function doorCheck(handoffTotalCents: number | null, staffCents: number | null): DoorCheck {
	if (handoffTotalCents === null && staffCents === null) return 'none';
	if (handoffTotalCents === null || staffCents === null) return 'single';
	return handoffTotalCents === staffCents ? 'agreed' : 'mismatch';
}

/**
 * The staff count and every handoff were made by one person, so no second
 * pair of eyes saw the till. A warning, never a refusal: a small night has one
 * door person. An unknown counter (a deleted account) is not the same person.
 */
export function oneCounter(
	handoffCounterIds: readonly (string | null)[],
	staffCounterId: string | null
): boolean {
	if (staffCounterId === null || handoffCounterIds.length === 0) return false;
	return handoffCounterIds.every((id) => id === staffCounterId);
}
