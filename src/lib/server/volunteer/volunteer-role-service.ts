import { db } from '$lib/server/db';
import { volunteerRole, volunteerHourLog } from '$lib/server/db/schema/volunteer';
import { eq, and, asc, count, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import {
	VOLUNTEER_ROLE_DESCRIPTION_MAX,
	VOLUNTEER_ROLE_NAME_MAX,
	VOLUNTEER_SHIFT_MAX_CAPACITY
} from '$lib/config';
import type { VolunteerRole, VolunteerRoleGroup } from '$lib/server/db/schema/volunteer';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class VolunteerRoleNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Volunteer role not found');
	}
}

export class VolunteerRoleNameTakenError extends DomainError {
	readonly httpStatus = 409;
	constructor(name: string) {
		super(`A volunteer role named "${name}" already exists`);
	}
}

export class VolunteerRoleInUseError extends DomainError {
	readonly httpStatus = 409;
	constructor(logCount: number) {
		super(
			`This role has ${logCount} hour ${logCount === 1 ? 'log' : 'logs'} against it. ` +
				`Archive it instead — deleting it would remove those hours from every report.`
		);
	}
}

export class VolunteerRoleValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface RoleInput {
	name?: string;
	description?: string | null;
	group?: VolunteerRoleGroup;
	displayOrder?: number;
	isActive?: boolean;
	/** What the New Shift form starts with. `null` clears it. Not a limit. */
	defaultDurationMinutes?: number | null;
	defaultCapacity?: number | null;
	/** Whether hours here are recognizable contributed services. */
	isSpecializedSkill?: boolean;
	/** What the skill costs to buy, per hour. `null` is "nobody has priced it". */
	marketRateCents?: number | null;
}

// A day. Long enough for anything the club actually schedules, short enough
// that a mistyped "480" hours can't produce a shift ending next year.
const MAX_DEFAULT_DURATION_MINUTES = 1440;

function normalize(data: RoleInput) {
	const normalized: RoleInput = {};

	if (data.name !== undefined) {
		const name = data.name.trim();
		if (!name) throw new VolunteerRoleValidationError('Name is required');
		if (name.length > VOLUNTEER_ROLE_NAME_MAX) {
			throw new VolunteerRoleValidationError(
				`Name must be ${VOLUNTEER_ROLE_NAME_MAX} characters or fewer`
			);
		}
		normalized.name = name;
	}

	if (data.description !== undefined) {
		const description = data.description?.trim() ?? '';
		if (description.length > VOLUNTEER_ROLE_DESCRIPTION_MAX) {
			throw new VolunteerRoleValidationError(
				`Description must be ${VOLUNTEER_ROLE_DESCRIPTION_MAX} characters or fewer`
			);
		}
		normalized.description = description || null;
	}

	if (data.displayOrder !== undefined) {
		if (!Number.isInteger(data.displayOrder) || data.displayOrder < 0) {
			throw new VolunteerRoleValidationError('Display order must be a whole number of 0 or more');
		}
		normalized.displayOrder = data.displayOrder;
	}

	// Both defaults are optional and clearable, so `null` is a legitimate value and
	// only a present non-null one gets range-checked. The ceilings match what the
	// shift form and the `volunteer_shift_capacity_positive` check already allow —
	// a default that couldn't be submitted as a shift is just a trap.
	if (data.defaultDurationMinutes !== undefined) {
		const minutes = data.defaultDurationMinutes;
		if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1)) {
			throw new VolunteerRoleValidationError(
				'Usual length must be a whole number of minutes, or blank'
			);
		}
		if (minutes !== null && minutes > MAX_DEFAULT_DURATION_MINUTES) {
			throw new VolunteerRoleValidationError(
				`Usual length must be ${MAX_DEFAULT_DURATION_MINUTES} minutes or fewer`
			);
		}
		normalized.defaultDurationMinutes = minutes;
	}

	if (data.isSpecializedSkill !== undefined) {
		normalized.isSpecializedSkill = data.isSpecializedSkill;
	}

	if (data.marketRateCents !== undefined) {
		const rate = data.marketRateCents;
		if (rate !== null && (!Number.isInteger(rate) || rate < 0)) {
			throw new VolunteerRoleValidationError(
				'Market rate must be a whole number of cents, or blank'
			);
		}
		normalized.marketRateCents = rate;
	}

	// Turning the flag off clears the rate, rather than leaving a number that
	// nothing reads and that would reappear if the flag were switched back on
	// months later. A rate on a role that is not a specialized skill is not a
	// value waiting to be used — it is a claim nobody is making.
	if (normalized.isSpecializedSkill === false) {
		normalized.marketRateCents = null;
	}

	if (data.defaultCapacity !== undefined) {
		const capacity = data.defaultCapacity;
		if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
			throw new VolunteerRoleValidationError(
				'People needed must be a whole number of 1 or more, or blank'
			);
		}
		if (capacity !== null && capacity > VOLUNTEER_SHIFT_MAX_CAPACITY) {
			throw new VolunteerRoleValidationError(
				`People needed must be ${VOLUNTEER_SHIFT_MAX_CAPACITY} or fewer`
			);
		}
		normalized.defaultCapacity = capacity;
	}

	if (data.group !== undefined) normalized.group = data.group;

	if (data.isActive !== undefined) normalized.isActive = data.isActive;

	return normalized;
}

// SQLite reports a unique-constraint breach as a driver error rather than
// something typed, so match on the message the same way the rest of the app
// would have to.
function isUniqueViolation(err: unknown): boolean {
	return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createVolunteerRole(
	data: RoleInput & { name: string }
): Promise<VolunteerRole> {
	const values = normalize(data);

	try {
		const [row] = await db
			.insert(volunteerRole)
			.values({
				name: values.name!,
				description: values.description ?? null,
				// Column default covers the omitted case, but drizzle needs the key
				// present to keep the insert shape stable across call sites.
				...(values.group ? { group: values.group } : {}),
				displayOrder: values.displayOrder ?? 0,
				isActive: values.isActive ?? true,
				defaultDurationMinutes: values.defaultDurationMinutes ?? null,
				defaultCapacity: values.defaultCapacity ?? null,
				isSpecializedSkill: values.isSpecializedSkill ?? false,
				marketRateCents: values.marketRateCents ?? null
			})
			.returning();
		return row;
	} catch (err) {
		if (isUniqueViolation(err)) throw new VolunteerRoleNameTakenError(values.name!);
		throw err;
	}
}

export async function updateVolunteerRole(id: string, data: RoleInput): Promise<VolunteerRole> {
	const values = normalize(data);

	try {
		const [row] = await db
			.update(volunteerRole)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(volunteerRole.id, id))
			.returning();

		if (!row) throw new VolunteerRoleNotFoundError();
		return row;
	} catch (err) {
		if (isUniqueViolation(err)) throw new VolunteerRoleNameTakenError(values.name!);
		throw err;
	}
}

/**
 * Retire a role. Archiving hides it from the member submit form and nowhere
 * else — staff filters and every report still resolve it, because the work
 * happened.
 */
export async function archiveVolunteerRole(id: string): Promise<VolunteerRole> {
	return setActive(id, false);
}

export async function restoreVolunteerRole(id: string): Promise<VolunteerRole> {
	return setActive(id, true);
}

async function setActive(id: string, isActive: boolean): Promise<VolunteerRole> {
	const [row] = await db
		.update(volunteerRole)
		.set({ isActive, updatedAt: new Date() })
		.where(eq(volunteerRole.id, id))
		.returning();

	if (!row) throw new VolunteerRoleNotFoundError();
	return row;
}

/**
 * Hard delete, permitted only for a role nothing has been logged against. The
 * FK is ON DELETE RESTRICT, so this guard is the friendly version of a
 * constraint failure — same shape as equipment's deleteCategory.
 */
export async function deleteVolunteerRole(id: string): Promise<VolunteerRole> {
	const [usage] = await db
		.select({ count: count() })
		.from(volunteerHourLog)
		.where(eq(volunteerHourLog.volunteerRoleId, id));

	if ((usage?.count ?? 0) > 0) throw new VolunteerRoleInUseError(usage.count);

	const [row] = await db.delete(volunteerRole).where(eq(volunteerRole.id, id)).returning();

	if (!row) throw new VolunteerRoleNotFoundError();
	return row;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface VolunteerRoleWithUsage extends VolunteerRole {
	logCount: number;
}

export async function listVolunteerRoles(
	opts: { includeInactive?: boolean } = {}
): Promise<VolunteerRoleWithUsage[]> {
	const where = opts.includeInactive ? undefined : eq(volunteerRole.isActive, true);

	const rows = await db
		.select({
			role: volunteerRole,
			logCount: sql<number>`count(${volunteerHourLog.id})`
		})
		.from(volunteerRole)
		.leftJoin(volunteerHourLog, eq(volunteerHourLog.volunteerRoleId, volunteerRole.id))
		.where(where)
		.groupBy(volunteerRole.id)
		.orderBy(asc(volunteerRole.displayOrder), asc(volunteerRole.name));

	return rows.map((row) => ({ ...row.role, logCount: Number(row.logCount) }));
}

export async function getVolunteerRoleById(id: string): Promise<VolunteerRole | null> {
	const [row] = await db.select().from(volunteerRole).where(eq(volunteerRole.id, id)).limit(1);
	return row ?? null;
}

/** Used by the submit path, which may only file against a live role. */
export async function getActiveVolunteerRoleById(id: string): Promise<VolunteerRole | null> {
	const [row] = await db
		.select()
		.from(volunteerRole)
		.where(and(eq(volunteerRole.id, id), eq(volunteerRole.isActive, true)))
		.limit(1);
	return row ?? null;
}
