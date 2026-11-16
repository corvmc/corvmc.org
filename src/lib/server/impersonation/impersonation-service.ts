import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { positionsFor } from '#lib/server/authorization.js';
import { DomainError } from '#lib/server/domain-error.js';
import { memberSubject, recordAuditEntry } from '#lib/server/audit/audit-service.js';
import type { AuditActor } from '#lib/types/audit.js';

/**
 * Viewing the app as a member (#2847). Only an admin may, checked on the
 * `admin` role rather than a capability, so no position or committee grant can
 * hand it out. An admin is never viewed as. The admin may act as the member;
 * start, stop and every write are audited with the admin as the actor.
 */

export class ImpersonationRefusedError extends DomainError {
	readonly httpStatus = 403;
}

export async function isAdmin(userId: string): Promise<boolean> {
	return (await positionsFor(userId)).includes('admin');
}

export async function assertMayImpersonate(adminId: string, memberId: string): Promise<void> {
	if (adminId === memberId) {
		throw new ImpersonationRefusedError('You cannot view the app as yourself.');
	}
	if (!(await isAdmin(adminId))) {
		throw new ImpersonationRefusedError('Only an administrator can view the app as a member.');
	}
	const [target] = await db
		.select({ deletedAt: user.deletedAt })
		.from(user)
		.where(eq(user.id, memberId))
		.limit(1);
	if (!target || target.deletedAt) {
		throw new ImpersonationRefusedError('That member has no active account.');
	}
	if (await isAdmin(memberId)) {
		throw new ImpersonationRefusedError('An administrator cannot be viewed as.');
	}
}

export async function recordImpersonation(
	kind: 'started' | 'stopped',
	admin: AuditActor,
	memberId: string
): Promise<void> {
	await recordAuditEntry({
		action: kind === 'started' ? 'user.impersonation_started' : 'user.impersonation_stopped',
		actor: admin,
		subject: await memberSubject(memberId),
		details: {}
	});
}

/** One request that could write, made while viewing as the member. */
export async function recordImpersonatedWrite(
	admin: AuditActor,
	memberId: string,
	details: { method: string; path: string; status: number }
): Promise<void> {
	await recordAuditEntry({
		action: 'user.impersonated_write',
		actor: admin,
		subject: await memberSubject(memberId),
		details
	});
}
