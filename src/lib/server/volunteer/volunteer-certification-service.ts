import { db } from '$lib/server/db';
import {
	volunteerCertification,
	memberCertification,
	volunteerRoleCertification
} from '$lib/server/db/schema/volunteer';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import { CERT_DESCRIPTION_MAX, CERT_NAME_MAX } from '$lib/config';
import type { VolunteerCertification } from '$lib/server/db/schema/volunteer';

// ---------------------------------------------------------------------------
// The certification catalog
// ---------------------------------------------------------------------------
// A certification is a *thing*, not a property of a role: First Aid is not a
// volunteer role and sound-desk clearance covers several at once, so roles
// reference certifications and not the other way round.
// ---------------------------------------------------------------------------

export class CertificationNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Certification not found');
	}
}

export class CertificationNameTakenError extends DomainError {
	readonly httpStatus = 409;
	constructor(name: string) {
		super(`A certification named "${name}" already exists`);
	}
}

export class CertificationInUseError extends DomainError {
	readonly httpStatus = 409;
	constructor(holderCount: number) {
		super(
			`${holderCount} ${holderCount === 1 ? 'member holds' : 'members hold'} this certification. ` +
				`Archive it instead — deleting it would erase the record of who was cleared and when.`
		);
	}
}

export class CertificationValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

interface CertificationInput {
	name?: string;
	description?: string | null;
	issuedBy?: string | null;
	validityMonths?: number | null;
	displayOrder?: number;
	isActive?: boolean;
}

function normalize(data: CertificationInput) {
	const normalized: CertificationInput = {};

	if (data.name !== undefined) {
		const name = data.name.trim();
		if (!name) throw new CertificationValidationError('Name is required');
		if (name.length > CERT_NAME_MAX) {
			throw new CertificationValidationError(`Name must be ${CERT_NAME_MAX} characters or fewer`);
		}
		normalized.name = name;
	}

	if (data.description !== undefined) {
		const description = data.description?.trim() ?? '';
		if (description.length > CERT_DESCRIPTION_MAX) {
			throw new CertificationValidationError(
				`Description must be ${CERT_DESCRIPTION_MAX} characters or fewer`
			);
		}
		normalized.description = description || null;
	}

	if (data.issuedBy !== undefined) {
		normalized.issuedBy = data.issuedBy?.trim() || null;
	}

	if (data.validityMonths !== undefined) {
		if (data.validityMonths === null) {
			normalized.validityMonths = null;
		} else {
			if (!Number.isInteger(data.validityMonths) || data.validityMonths < 1) {
				throw new CertificationValidationError(
					'Validity must be a whole number of months, or blank if it never expires'
				);
			}
			normalized.validityMonths = data.validityMonths;
		}
	}

	if (data.displayOrder !== undefined) {
		if (!Number.isInteger(data.displayOrder) || data.displayOrder < 0) {
			throw new CertificationValidationError('Display order must be a whole number of 0 or more');
		}
		normalized.displayOrder = data.displayOrder;
	}

	if (data.isActive !== undefined) normalized.isActive = data.isActive;

	return normalized;
}

function isUniqueViolation(err: unknown): boolean {
	return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createCertification(data: {
	name: string;
	description?: string | null;
	issuedBy?: string | null;
	validityMonths?: number | null;
	displayOrder?: number;
	isActive?: boolean;
}): Promise<VolunteerCertification> {
	const values = normalize(data);

	try {
		const [row] = await db
			.insert(volunteerCertification)
			.values({
				name: values.name!,
				description: values.description ?? null,
				issuedBy: values.issuedBy ?? null,
				validityMonths: values.validityMonths ?? null,
				displayOrder: values.displayOrder ?? 0,
				isActive: values.isActive ?? true
			})
			.returning();
		return row;
	} catch (err) {
		if (isUniqueViolation(err)) throw new CertificationNameTakenError(values.name!);
		throw err;
	}
}

/**
 * Editing `validityMonths` applies to **future grants only** — every existing
 * `member_certification` keeps the `expiresAt` it was stamped with. That is the
 * whole reason expiry is stored rather than computed, and the staff form says so.
 */
export async function updateCertification(
	id: string,
	data: CertificationInput
): Promise<VolunteerCertification> {
	const values = normalize(data);

	try {
		const [row] = await db
			.update(volunteerCertification)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(volunteerCertification.id, id))
			.returning();

		if (!row) throw new CertificationNotFoundError();
		return row;
	} catch (err) {
		if (isUniqueViolation(err)) throw new CertificationNameTakenError(values.name!);
		throw err;
	}
}

export async function archiveCertification(id: string): Promise<VolunteerCertification> {
	return setActive(id, false);
}

export async function restoreCertification(id: string): Promise<VolunteerCertification> {
	return setActive(id, true);
}

async function setActive(id: string, isActive: boolean): Promise<VolunteerCertification> {
	const [row] = await db
		.update(volunteerCertification)
		.set({ isActive, updatedAt: new Date() })
		.where(eq(volunteerCertification.id, id))
		.returning();

	if (!row) throw new CertificationNotFoundError();
	return row;
}

/**
 * Hard delete, permitted only when nobody holds it. The FK from
 * `member_certification` is ON DELETE RESTRICT, so this guard is the friendly
 * version of a constraint failure — and the constraint is there because a held
 * clearance is history, not a preference.
 */
export async function deleteCertification(id: string): Promise<VolunteerCertification> {
	const [usage] = await db
		.select({ count: count() })
		.from(memberCertification)
		.where(eq(memberCertification.certificationId, id));

	if ((usage?.count ?? 0) > 0) throw new CertificationInUseError(usage.count);

	const [row] = await db
		.delete(volunteerCertification)
		.where(eq(volunteerCertification.id, id))
		.returning();

	if (!row) throw new CertificationNotFoundError();
	return row;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface CertificationWithUsage extends VolunteerCertification {
	holderCount: number;
	roleCount: number;
}

export async function listCertifications(
	opts: { includeInactive?: boolean } = {}
): Promise<CertificationWithUsage[]> {
	const where = opts.includeInactive ? undefined : eq(volunteerCertification.isActive, true);

	// Two aggregates over different join paths, so they're counted separately
	// rather than in one query — joining both would multiply the rows and
	// inflate each count by the other's cardinality.
	const rows = await db
		.select()
		.from(volunteerCertification)
		.where(where)
		.orderBy(asc(volunteerCertification.displayOrder), asc(volunteerCertification.name));

	if (rows.length === 0) return [];

	const ids = rows.map((r) => r.id);

	const holders = await db
		.select({ id: memberCertification.certificationId, n: count() })
		.from(memberCertification)
		.where(inArray(memberCertification.certificationId, ids))
		.groupBy(memberCertification.certificationId);

	const roles = await db
		.select({ id: volunteerRoleCertification.certificationId, n: count() })
		.from(volunteerRoleCertification)
		.where(inArray(volunteerRoleCertification.certificationId, ids))
		.groupBy(volunteerRoleCertification.certificationId);

	const holderBy = new Map(holders.map((h) => [h.id, Number(h.n)]));
	const roleBy = new Map(roles.map((r) => [r.id, Number(r.n)]));

	return rows.map((row) => ({
		...row,
		holderCount: holderBy.get(row.id) ?? 0,
		roleCount: roleBy.get(row.id) ?? 0
	}));
}

export async function getCertificationById(id: string): Promise<VolunteerCertification | null> {
	const [row] = await db
		.select()
		.from(volunteerCertification)
		.where(eq(volunteerCertification.id, id))
		.limit(1);
	return row ?? null;
}

// ---------------------------------------------------------------------------
// Role requirements
// ---------------------------------------------------------------------------

/** Which certifications a role requires. */
export async function getRequirementsForRole(roleId: string): Promise<VolunteerCertification[]> {
	return db
		.select({
			id: volunteerCertification.id,
			name: volunteerCertification.name,
			description: volunteerCertification.description,
			issuedBy: volunteerCertification.issuedBy,
			validityMonths: volunteerCertification.validityMonths,
			displayOrder: volunteerCertification.displayOrder,
			isActive: volunteerCertification.isActive,
			createdAt: volunteerCertification.createdAt,
			updatedAt: volunteerCertification.updatedAt
		})
		.from(volunteerRoleCertification)
		.innerJoin(
			volunteerCertification,
			eq(volunteerCertification.id, volunteerRoleCertification.certificationId)
		)
		.where(eq(volunteerRoleCertification.volunteerRoleId, roleId))
		.orderBy(asc(volunteerCertification.displayOrder), asc(volunteerCertification.name));
}

/** Requirements for many roles at once, so the shift list doesn't N+1. */
export async function getRequirementsForRoles(
	roleIds: string[]
): Promise<Map<string, { id: string; name: string }[]>> {
	const byRole = new Map<string, { id: string; name: string }[]>();
	if (roleIds.length === 0) return byRole;

	const rows = await db
		.select({
			roleId: volunteerRoleCertification.volunteerRoleId,
			id: volunteerCertification.id,
			name: volunteerCertification.name
		})
		.from(volunteerRoleCertification)
		.innerJoin(
			volunteerCertification,
			eq(volunteerCertification.id, volunteerRoleCertification.certificationId)
		)
		.where(inArray(volunteerRoleCertification.volunteerRoleId, roleIds))
		.orderBy(asc(volunteerCertification.name));

	for (const row of rows) {
		const list = byRole.get(row.roleId) ?? [];
		list.push({ id: row.id, name: row.name });
		byRole.set(row.roleId, list);
	}
	return byRole;
}

/**
 * Replace a role's required certifications. Same replace-the-set shape as
 * `setInterests` — the edit form always posts the whole list.
 */
export async function setRoleRequirements(
	roleId: string,
	certificationIds: string[]
): Promise<void> {
	const wanted = [...new Set(certificationIds)];

	if (wanted.length > 0) {
		const live = await db
			.select({ id: volunteerCertification.id })
			.from(volunteerCertification)
			.where(inArray(volunteerCertification.id, wanted));

		if (live.length !== wanted.length) {
			throw new CertificationValidationError(
				'One of those certifications no longer exists. Reload the page and try again.'
			);
		}
	}

	const existing = await db
		.select({ id: volunteerRoleCertification.certificationId })
		.from(volunteerRoleCertification)
		.where(eq(volunteerRoleCertification.volunteerRoleId, roleId));

	const have = new Set(existing.map((r) => r.id));
	const toAdd = wanted.filter((id) => !have.has(id));
	const toRemove = [...have].filter((id) => !wanted.includes(id));

	if (toRemove.length > 0) {
		await db
			.delete(volunteerRoleCertification)
			.where(
				and(
					eq(volunteerRoleCertification.volunteerRoleId, roleId),
					inArray(volunteerRoleCertification.certificationId, toRemove)
				)
			);
	}

	if (toAdd.length > 0) {
		await db
			.insert(volunteerRoleCertification)
			.values(toAdd.map((certificationId) => ({ volunteerRoleId: roleId, certificationId })))
			.onConflictDoNothing();
	}
}
