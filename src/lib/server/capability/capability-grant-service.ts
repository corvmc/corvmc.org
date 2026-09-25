import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { group, groupCapability } from '$lib/server/db/schema/group';
import { volunteerRole, volunteerRoleCapability } from '$lib/server/db/schema/volunteer';
import { recordAuditEntry } from '$lib/server/audit/audit-service';
import { DomainError } from '$lib/server/domain-error';
import { positionsGrant } from '$lib/server/authorization';
import { grantRuleFor, type Capability, type GrantCarrier } from '$lib/config';

export class UngrantableCapabilityError extends DomainError {
	readonly httpStatus = 400;
}

export class GrantCarrierNotFoundError extends DomainError {
	readonly httpStatus = 404;
}

export class GrantBeyondEditorError extends DomainError {
	readonly httpStatus = 403;
}

/** Refuse anything the allowlist does not let `carrier` hold, then de-duplicate. */
export function validateGrants(caps: readonly string[], carrier: GrantCarrier): string[] {
	for (const cap of caps) {
		if (grantRuleFor(cap)?.[carrier] === undefined) {
			throw new UngrantableCapabilityError(`A ${carrier} cannot grant ${cap}`);
		}
	}
	return [...new Set(caps)].sort();
}

/** A volunteer role's stored grant list, sorted. Unfiltered: the editor shows what is stored. */
export async function listRoleGrants(roleId: string): Promise<string[]> {
	const rows = await db
		.select({ capability: volunteerRoleCapability.capability })
		.from(volunteerRoleCapability)
		.where(eq(volunteerRoleCapability.volunteerRoleId, roleId));
	return rows.map((r) => r.capability).sort();
}

/** A committee's stored grant list, sorted. */
export async function listGroupGrants(groupId: string): Promise<string[]> {
	const rows = await db
		.select({ capability: groupCapability.capability })
		.from(groupCapability)
		.where(eq(groupCapability.groupId, groupId));
	return rows.map((r) => r.capability).sort();
}

function diff(before: readonly string[], after: readonly string[]) {
	return {
		added: after.filter((c) => !before.includes(c)),
		removed: before.filter((c) => !after.includes(c))
	};
}

/**
 * Replace a volunteer role's grant list. Returns what changed; audited when
 * anything did. An editor may add only what their own position holds, so a
 * grant never widens what its author could already do.
 */
export async function setRoleCapabilityGrants(
	roleId: string,
	caps: readonly string[],
	opts: { editorId: string }
) {
	const next = validateGrants(caps, 'role');
	const [row] = await db
		.select({ name: volunteerRole.name })
		.from(volunteerRole)
		.where(eq(volunteerRole.id, roleId))
		.limit(1);
	if (!row) throw new GrantCarrierNotFoundError('Role not found');

	const change = diff(await listRoleGrants(roleId), next);
	for (const cap of change.added) {
		if (!(await positionsGrant(opts.editorId, cap as Capability))) {
			throw new GrantBeyondEditorError(
				`Your position does not hold ${cap}, so you cannot grant it`
			);
		}
	}
	// Delete then insert, in one batch: D1 has no working transaction.
	const touch = db
		.update(volunteerRole)
		.set({ updatedAt: new Date() })
		.where(eq(volunteerRole.id, roleId));
	const clear = db
		.delete(volunteerRoleCapability)
		.where(eq(volunteerRoleCapability.volunteerRoleId, roleId));
	const rows = next.map((capability) => ({ volunteerRoleId: roleId, capability }));
	if (rows.length) await db.batch([touch, clear, db.insert(volunteerRoleCapability).values(rows)]);
	else await db.batch([touch, clear]);
	if (change.added.length || change.removed.length) {
		await recordAuditEntry({
			action: 'capability.grants_changed',
			subject: { type: 'role', id: roleId, label: row.name },
			details: change
		});
	}
	return change;
}

/** Replace a committee's grant list. A band or a club carries none, so either is a 404. */
export async function setCommitteeCapabilityGrants(groupId: string, caps: readonly string[]) {
	const next = validateGrants(caps, 'committee');
	const [row] = await db
		.select({ name: group.name, kind: group.kind })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);
	if (!row || row.kind !== 'committee') throw new GrantCarrierNotFoundError('Committee not found');

	const change = diff(await listGroupGrants(groupId), next);
	const touch = db.update(group).set({ updatedAt: new Date() }).where(eq(group.id, groupId));
	const clear = db.delete(groupCapability).where(eq(groupCapability.groupId, groupId));
	const rows = next.map((capability) => ({ groupId, capability }));
	if (rows.length) await db.batch([touch, clear, db.insert(groupCapability).values(rows)]);
	else await db.batch([touch, clear]);
	if (change.added.length || change.removed.length) {
		await recordAuditEntry({
			action: 'capability.grants_changed',
			subject: { type: 'group', id: groupId, label: row.name },
			details: change
		});
	}
	return change;
}
