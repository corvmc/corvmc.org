import { and, count, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { role, modelHasRole } from '$lib/server/db/schema/authorization';
import { user } from '$lib/server/db/schema/authentication';
import { DomainError } from '$lib/server/domain-error';
import { getUserRoles, isPosition } from '$lib/server/authorization';
import { recordAuditEntry } from '$lib/server/audit/audit-service';
import type { Position } from '$lib/config';

/** A position change that would lock people out of the panel. */
export class PositionChangeRefusedError extends DomainError {
	constructor(
		message: string,
		readonly httpStatus: 400 | 409
	) {
		super(message);
	}
}

/**
 * The two role changes refused outright, wherever roles are edited: dropping
 * your own last position, and demoting the last admin. Admin alone holds
 * `user.setRole`, so either leaves a state only `wrangler d1 execute` can undo.
 * Returns the refusal rather than throwing so a remote can pick its own error.
 */
export async function positionChangeRefusal(input: {
	actorId: string;
	targetId: string;
	current: readonly string[];
	next: readonly string[];
}): Promise<PositionChangeRefusedError | null> {
	const { actorId, targetId, current, next } = input;
	if (targetId === actorId && !next.some(isPosition)) {
		return new PositionChangeRefusedError('You cannot remove your own staff access.', 400);
	}
	if (current.includes('admin') && !next.includes('admin')) {
		const [{ value }] = await db
			.select({ value: count() })
			.from(modelHasRole)
			.innerJoin(role, eq(role.id, modelHasRole.roleId))
			.where(and(eq(role.name, 'admin'), ne(modelHasRole.userId, targetId)));
		if (value === 0) {
			return new PositionChangeRefusedError(
				'This is the last admin — assign another admin before removing this role.',
				409
			);
		}
	}
	return null;
}

/**
 * Give or take one position, recorded as `user.roles_changed` exactly as the
 * profile form records it. A position with no `roles` row yet gets one: the
 * matrix, not the table, says which positions exist.
 */
export async function setPosition(input: {
	actorId: string;
	targetId: string;
	position: Position;
	held: boolean;
}): Promise<{ added: string[]; removed: string[] }> {
	const { actorId, targetId, position, held } = input;
	const current = await getUserRoles(targetId);
	if (current.includes(position) === held) return { added: [], removed: [] };

	const next = held ? [...current, position] : current.filter((n) => n !== position);
	const refusal = await positionChangeRefusal({ actorId, targetId, current, next });
	if (refusal) throw refusal;

	if (held) {
		await db.insert(role).values({ name: position }).onConflictDoNothing();
	}
	const [found] = await db.select({ id: role.id }).from(role).where(eq(role.name, position));
	if (held) {
		await db.insert(modelHasRole).values({ roleId: found.id, userId: targetId });
	} else {
		await db
			.delete(modelHasRole)
			.where(and(eq(modelHasRole.roleId, found.id), eq(modelHasRole.userId, targetId)));
	}

	const change = held ? { added: [position], removed: [] } : { added: [], removed: [position] };
	const [target] = await db.select({ name: user.name }).from(user).where(eq(user.id, targetId));
	await recordAuditEntry({
		action: 'user.roles_changed',
		subject: { type: 'user', id: targetId, label: target?.name },
		details: change
	});
	return change;
}
