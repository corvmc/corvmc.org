import { z } from 'zod';
import { form } from './_remote';
import { requireProgramRole } from '#lib/server/group/group-context.js';
import {
	POSITION_NAME_MAX,
	createPosition,
	deletePosition,
	renamePosition,
	setHolders
} from '#lib/server/group/position-service.js';

/**
 * A committee's defined positions (#2988). Its chair names and fills them;
 * Operations (`group.manage`) can too, for a committee without a chair. The
 * committee comes from the slug and every position id is checked against it.
 */
const chair = (slug: string) => requireProgramRole({ slug }, 'admin', { staff: 'group.manage' });

const positionName = z
	.string()
	.trim()
	.min(1, 'Name the position')
	.max(POSITION_NAME_MAX, `Keep it to ${POSITION_NAME_MAX} characters`);

export const createCommitteePosition = form(
	z.object({ slug: z.string().min(1), name: positionName }),
	async (data) => {
		const { group } = await chair(data.slug);
		const row = await createPosition(group.id, data.name);
		return { success: true, positionId: row.id };
	}
);

/** The name and the holders in one save: the modal edits both. */
export const updateCommitteePosition = form(
	z.object({
		slug: z.string().min(1),
		positionId: z.string().min(1),
		name: positionName,
		memberIds: z.array(z.string().min(1)).max(50).default([])
	}),
	async (data) => {
		const { user, group } = await chair(data.slug);
		await renamePosition(group.id, data.positionId, data.name);
		await setHolders(group.id, data.positionId, data.memberIds, user.id);
		return { success: true };
	}
);

export const deleteCommitteePosition = form(
	z.object({ slug: z.string().min(1), positionId: z.string().min(1) }),
	async (data) => {
		const { group } = await chair(data.slug);
		await deletePosition(group.id, data.positionId);
		return { success: true };
	}
);
