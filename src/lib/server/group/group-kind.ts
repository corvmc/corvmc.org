import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { group } from '$lib/server/db/schema/group';
import { DomainError } from '$lib/server/domain-error';

/**
 * A band reached a path that belongs to a club or committee.
 *
 * 404 rather than 403, matching `requireProgramRole`: a band names no program,
 * and what role the caller holds in it is beside the point.
 */
export class NotAProgramError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Group not found');
	}
}

/**
 * Free room time travels with `kind`, so a write that can hold the room has to
 * read it. `requireProgramRole` already 404s the endpoints; this is the same
 * rule as an invariant of the data rather than of one guard, so a job, a script
 * or the next creator someone adds gets the answer without knowing to ask.
 *
 * A group that resolves to nothing is the same 404 — it is not a program either.
 */
export async function requireProgramGroup(groupId: string): Promise<void> {
	const [row] = await db
		.select({ kind: group.kind })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);

	if (!row || row.kind === 'band') throw new NotAProgramError();
}
