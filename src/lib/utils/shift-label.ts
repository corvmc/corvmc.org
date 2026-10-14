/** What a work order with no volunteer role shows where a role name would go. */
export const NO_ROLE_LABEL = 'No role';

/**
 * What to call a shift.
 *
 * Three sources, in the order a reader would want them: its own name, the show
 * it staffs, then the role as the last resort. A contractor's or unassigned
 * work order may have none of the three.
 */
export function shiftLabel(shift: {
	title?: string | null;
	eventTitle?: string | null;
	roleName: string | null;
}): string {
	return shift.title?.trim() || shift.eventTitle?.trim() || shift.roleName || 'Untitled task';
}

/**
 * The role, where it is not already the label.
 *
 * A card shows the label big and this underneath — but repeating "Work
 * Parties" twice when the role IS the label is noise, so this returns null.
 */
export function shiftRoleSuffix(shift: {
	title?: string | null;
	eventTitle?: string | null;
	roleName: string | null;
}): string | null {
	if (shift.roleName === null) return NO_ROLE_LABEL;
	return shiftLabel(shift) === shift.roleName ? null : shift.roleName;
}
