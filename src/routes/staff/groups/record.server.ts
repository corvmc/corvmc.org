import { error, redirect } from '@sveltejs/kit';
import type { GroupKind } from '#lib/config.js';
import { getGroupDetail } from '#lib/server/group/group-service.js';
import { staffGroupHref } from '#lib/utils/group-href.js';

/**
 * A record page answers for one kind; another kind's id goes to its own list's
 * record, so a link that only knows the group still lands. Navigation only:
 * each kind's record runs its own guarded query.
 */
export async function loadGroupRecord(kind: GroupKind, id: string): Promise<void> {
	const group = await getGroupDetail(id);
	if (!group) error(404, 'Group not found');
	if (group.kind !== kind) redirect(307, staffGroupHref(group.kind, group.id));
}
