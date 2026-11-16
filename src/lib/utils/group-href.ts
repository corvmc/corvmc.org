import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { GroupKind } from '#lib/config.js';

/**
 * Each kind of group has its own staff list, in the section it belongs to:
 * bands in Community, clubs in Programs, committees in Operations (#3027).
 */
export function staffGroupListHref(kind: GroupKind): ResolvedPathname {
	if (kind === 'band') return resolve('/staff/bands');
	if (kind === 'club') return resolve('/staff/clubs');
	return resolve('/staff/committees');
}

/** A group's staff record, under its kind's list. */
export function staffGroupHref(kind: GroupKind, id: string): ResolvedPathname {
	if (kind === 'band') return resolve('/staff/bands/[id]', { id });
	if (kind === 'club') return resolve('/staff/clubs/[id]', { id });
	return resolve('/staff/committees/[id]', { id });
}
