import { db } from '#lib/server/db/index.js';
import { organization, type Organization } from '#lib/server/db/schema/party.js';
import { partyRole } from '#lib/server/db/schema/contact.js';
import { grantApplication } from '#lib/server/db/schema/grant.js';
import { sponsorship } from '#lib/server/db/schema/sponsor.js';
import { contractorJob } from '#lib/server/db/schema/contractor.js';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import { partyRoleLabels, type PartyRole } from '#lib/config.js';

/**
 * Outside organizations and the roles they hold (#2622). One business can be
 * several things to CMC. Records that name an organization in a role
 * (`grant_application`, `sponsorship`, `contractor_job`) call `requireRole`
 * before writing, since SQLite cannot check it. No guards here: remotes guard
 * with the record's own capability. People live in `contact-service.ts`.
 */

export class OrganizationNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor(what = 'Organization') {
		super(`${what} not found`);
	}
}

export class OrganizationLacksRoleError extends DomainError {
	readonly httpStatus = 422;
	constructor(role: PartyRole) {
		super(`That organization is not a ${partyRoleLabels[role].toLowerCase()}.`);
	}
}

export class OrganizationInUseError extends DomainError {
	readonly httpStatus = 409;
	constructor(n: number) {
		super(
			`${n} ${n === 1 ? 'record names' : 'records name'} this organization. Archive it instead.`
		);
	}
}

export type OrganizationInput = {
	name: string;
	website?: string | null;
	notes?: string | null;
};

export type OrganizationWithRoles = Organization & { roles: PartyRole[] };

/** The roles each organization holds. */
export async function rolesFor(ids: string[]): Promise<Map<string, PartyRole[]>> {
	const out = new Map<string, PartyRole[]>();
	if (ids.length === 0) return out;
	const rows = await db
		.select({ organizationId: partyRole.organizationId, role: partyRole.role })
		.from(partyRole)
		.where(inArray(partyRole.organizationId, ids));
	for (const r of rows) {
		const list = out.get(r.organizationId!) ?? [];
		list.push(r.role);
		out.set(r.organizationId!, list);
	}
	return out;
}

/** Organizations, optionally only those holding `role`, in name order. */
export async function listOrganizations(
	opts: { role?: PartyRole; includeArchived?: boolean } = {}
): Promise<OrganizationWithRoles[]> {
	const archived = opts.includeArchived ? undefined : isNull(organization.archivedAt);
	const rows = opts.role
		? await db
				.select({ org: organization })
				.from(organization)
				.innerJoin(
					partyRole,
					and(eq(partyRole.organizationId, organization.id), eq(partyRole.role, opts.role))
				)
				.where(archived)
				.orderBy(asc(organization.name))
				.then((r) => r.map((x) => x.org))
		: await db.select().from(organization).where(archived).orderBy(asc(organization.name));
	const roles = await rolesFor(rows.map((r) => r.id));
	return rows.map((r) => ({ ...r, roles: roles.get(r.id) ?? [] }));
}

export async function getOrganization(id: string): Promise<OrganizationWithRoles> {
	const [row] = await db.select().from(organization).where(eq(organization.id, id)).limit(1);
	if (!row) throw new OrganizationNotFoundError();
	const roles = await rolesFor([id]);
	return { ...row, roles: roles.get(id) ?? [] };
}

/** One organization, refused unless it holds `role`. */
export async function getOrganizationInRole(
	id: string,
	role: PartyRole
): Promise<OrganizationWithRoles> {
	const org = await getOrganization(id).catch((err) => {
		if (err instanceof OrganizationNotFoundError)
			throw new OrganizationNotFoundError(partyRoleLabels[role]);
		throw err;
	});
	if (!org.roles.includes(role)) throw new OrganizationNotFoundError(partyRoleLabels[role]);
	return org;
}

/** The write-side check SQLite cannot make: this organization holds `role`. */
export async function requireRole(id: string, role: PartyRole): Promise<void> {
	const [row] = await db
		.select({ id: partyRole.id })
		.from(partyRole)
		.where(and(eq(partyRole.organizationId, id), eq(partyRole.role, role)))
		.limit(1);
	if (!row) throw new OrganizationLacksRoleError(role);
}

export async function createOrganization(
	input: OrganizationInput,
	roles: PartyRole[] = []
): Promise<Organization> {
	const id = crypto.randomUUID();
	const [[row]] = await db.batch([
		db
			.insert(organization)
			.values({ id, ...input })
			.returning(),
		...roles.map((role) => db.insert(partyRole).values({ organizationId: id, role }))
	]);
	return row;
}

export async function updateOrganization(id: string, input: OrganizationInput): Promise<void> {
	const rows = await db
		.update(organization)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(organization.id, id))
		.returning({ id: organization.id });
	if (rows.length === 0) throw new OrganizationNotFoundError();
}

/** Off the active lists and pickers; every record that names it stays. */
export async function setOrganizationArchived(id: string, archived: boolean): Promise<void> {
	const rows = await db
		.update(organization)
		.set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
		.where(eq(organization.id, id))
		.returning({ id: organization.id });
	if (rows.length === 0) throw new OrganizationNotFoundError();
}

export async function addRole(id: string, role: PartyRole): Promise<void> {
	await getOrganization(id);
	await db.insert(partyRole).values({ organizationId: id, role }).onConflictDoNothing();
}

/** How many grant applications, sponsorships and contractor jobs name it. */
export async function countRecords(id: string): Promise<number> {
	const [[g], [s], [j]] = await db.batch([
		db.select({ n: count() }).from(grantApplication).where(eq(grantApplication.organizationId, id)),
		db.select({ n: count() }).from(sponsorship).where(eq(sponsorship.organizationId, id)),
		db.select({ n: count() }).from(contractorJob).where(eq(contractorJob.organizationId, id))
	]);
	return Number(g?.n ?? 0) + Number(s?.n ?? 0) + Number(j?.n ?? 0);
}

/**
 * Take a role away, for a row entered in the wrong place. Refused while
 * `inUse` records name it in that role. An organization left with no role
 * and no records is deleted outright.
 */
export async function removeRole(id: string, role: PartyRole, inUse: number): Promise<void> {
	if (inUse > 0) throw new OrganizationInUseError(inUse);
	const org = await getOrganization(id);
	await db.delete(partyRole).where(and(eq(partyRole.organizationId, id), eq(partyRole.role, role)));
	const rest = org.roles.filter((r) => r !== role);
	if (rest.length === 0 && (await countRecords(id)) === 0) {
		await db.delete(organization).where(eq(organization.id, id));
	}
}
