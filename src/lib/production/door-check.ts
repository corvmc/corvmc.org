/**
 * Where a show's two drawer counts stand (#2722). Pure, so the settlement,
 * the console and the close warning read the same answer.
 * `none` is a show nobody has counted, which is not a warning.
 */
export type DoorCheck = 'none' | 'single' | 'agreed' | 'mismatch';

export function doorCheck(firstCents: number | null, recountCents: number | null): DoorCheck {
	if (firstCents === null) return 'none';
	if (recountCents === null) return 'single';
	return firstCents === recountCents ? 'agreed' : 'mismatch';
}
