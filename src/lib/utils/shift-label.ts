/**
 * What to call a shift.
 *
 * Three sources, in the order a reader would want them: its own name, the show
 * it staffs, then the role as the last resort. Before `work_order.title`
 * existed only the last two were available, so two work parties on one
 * Saturday read identically on the claim board.
 */
export function shiftLabel(shift: {
	title?: string | null;
	eventTitle?: string | null;
	roleName: string;
}): string {
	return shift.title?.trim() || shift.eventTitle?.trim() || shift.roleName;
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
	roleName: string;
}): string | null {
	return shiftLabel(shift) === shift.roleName ? null : shift.roleName;
}
