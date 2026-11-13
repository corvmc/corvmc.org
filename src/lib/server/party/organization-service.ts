import { copyLinks } from '#lib/server/task/work-order-link.js';
import { moveActivity } from './activity-service';
import { moveThreads } from './thread-filing';
import { db } from '#lib/server/db/index.js';
import {
	contractorDetail,
	organization,
	vendorDetail,
	type Organization,
	type VendorDetail
} from '#lib/server/db/schema/party.js';
import { marketVendor } from '#lib/server/db/schema/market.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { mediaAttachment } from '#lib/server/db/schema/media.js';
import { workOrder } from '#lib/server/db/schema/volunteer.js';
import { partyRole } from '#lib/server/db/schema/contact.js';
import { grantApplication } from '#lib/server/db/schema/grant.js';
import { sponsorship } from '#lib/server/db/schema/sponsor.js';
import { contractorJob } from '#lib/server/db/schema/contractor.js';
import { purchaseOrder } from '#lib/server/db/schema/inventory.js';
import { and, asc, count, desc, eq, getTableName, inArray, isNull, sql } from 'drizzle-orm';
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

/**
 * The organization called `name`, compared trimmed and case-insensitively, now
 * holding `role`: a live one before an archived one, and created when none is.
 * For forms that name a party by typing it, such as a purchase order's supplier.
 */
export async function organizationNamed(name: string, role: PartyRole): Promise<string> {
	const clean = name.trim();
	const [found] = await db
		.select({ id: organization.id })
		.from(organization)
		.where(sql`lower(trim(${organization.name})) = lower(${clean})`)
		.orderBy(
			sql`${organization.archivedAt} is not null`,
			asc(organization.createdAt),
			asc(organization.id)
		)
		.limit(1);
	if (!found) return (await createOrganization({ name: clean }, [role])).id;
	await db.insert(partyRole).values({ organizationId: found.id, role }).onConflictDoNothing();
	return found.id;
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

export type VendorDetailInput = Omit<VendorDetail, 'organizationId' | 'updatedAt'>;

/** A vendor's standing tabling needs, or null when none are on file. */
export async function getVendorDetail(id: string): Promise<VendorDetail | null> {
	const [row] = await db
		.select()
		.from(vendorDetail)
		.where(eq(vendorDetail.organizationId, id))
		.limit(1);
	return row ?? null;
}

/** Write a vendor's standing needs. Past applications keep their own copy. */
export async function saveVendorDetail(id: string, input: VendorDetailInput): Promise<void> {
	await requireRole(id, 'vendor');
	await db
		.insert(vendorDetail)
		.values({ organizationId: id, ...input })
		.onConflictDoUpdate({
			target: vendorDetail.organizationId,
			set: { ...input, updatedAt: new Date() }
		});
}

export async function addRole(id: string, role: PartyRole): Promise<void> {
	await getOrganization(id);
	await db.insert(partyRole).values({ organizationId: id, role }).onConflictDoNothing();
}

/**
 * The records that name an organization in one of its roles. A merge moves
 * them and a role cannot be removed while one names it. `parties.spec.ts`
 * fails when a table references `organization` and is in neither this list
 * nor its list of tables moved some other way.
 */
export const ORGANIZATION_RECORDS = [
	grantApplication,
	sponsorship,
	contractorJob,
	purchaseOrder,
	marketVendor
];
export const organizationRecordTables: string[] = ORGANIZATION_RECORDS.map((t) => getTableName(t));

/** How many records name it, across every table in `ORGANIZATION_RECORDS`. */
export async function countRecords(id: string): Promise<number> {
	const [first, ...rest] = ORGANIZATION_RECORDS.map((t) =>
		db.select({ n: count() }).from(t).where(eq(t.organizationId, id))
	);
	const counts = await db.batch([first, ...rest]);
	return counts.reduce((n, [row]) => n + Number(row?.n ?? 0), 0);
}

/**
 * Take a role away, for a row entered in the wrong place. Refused while
 * `inUse` records name it in that role. An organization left with no role
 * and no records is deleted outright, and this returns true.
 */
export async function removeRole(id: string, role: PartyRole, inUse: number): Promise<boolean> {
	if (inUse > 0) throw new OrganizationInUseError(inUse);
	const org = await getOrganization(id);
	await db.delete(partyRole).where(and(eq(partyRole.organizationId, id), eq(partyRole.role, role)));
	const rest = org.roles.filter((r) => r !== role);
	if (rest.length === 0 && (await countRecords(id)) === 0) {
		await db.delete(organization).where(eq(organization.id, id));
		return true;
	}
	return false;
}
// ---------------------------------------------------------------------------
// The Contacts screens: records, duplicates and merging
// ---------------------------------------------------------------------------

export class OrganizationMergeError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('Pick two different organizations to merge.');
	}
}

/** What names an organization, for its page: one list per role it holds. */
export async function organizationRecords(id: string) {
	const [grants, sponsorships, jobs, orders, markets] = await Promise.all([
		db
			.select({
				id: grantApplication.id,
				title: grantApplication.title,
				status: grantApplication.status
			})
			.from(grantApplication)
			.where(eq(grantApplication.organizationId, id))
			.orderBy(desc(grantApplication.createdAt), desc(grantApplication.id)),
		db
			.select({
				id: sponsorship.id,
				title: sponsorship.title,
				status: sponsorship.status
			})
			.from(sponsorship)
			.where(eq(sponsorship.organizationId, id))
			.orderBy(desc(sponsorship.createdAt), desc(sponsorship.id)),
		db
			.select({
				id: contractorJob.id,
				status: contractorJob.status,
				title: sql<string>`coalesce(${workOrder.title}, 'Work order')`
			})
			.from(contractorJob)
			.innerJoin(workOrder, eq(workOrder.id, contractorJob.workOrderId))
			.where(eq(contractorJob.organizationId, id))
			.orderBy(desc(contractorJob.createdAt), desc(contractorJob.id)),
		db
			.select({
				id: purchaseOrder.id,
				reference: purchaseOrder.reference,
				status: purchaseOrder.status,
				placedAt: purchaseOrder.placedAt
			})
			.from(purchaseOrder)
			.where(eq(purchaseOrder.organizationId, id))
			.orderBy(desc(purchaseOrder.createdAt), desc(purchaseOrder.id)),
		db
			.select({
				id: marketVendor.id,
				eventId: marketVendor.eventId,
				title: eventListing.title,
				startsAt: eventListing.startsAt,
				status: marketVendor.status
			})
			.from(marketVendor)
			.innerJoin(eventListing, eq(eventListing.id, marketVendor.eventId))
			.where(eq(marketVendor.organizationId, id))
			.orderBy(desc(eventListing.startsAt), desc(marketVendor.id))
	]);
	return { grants, sponsorships, jobs, orders, markets };
}

/** `https://www.example.org/about` → `example.org`; null when there is no host. */
export function websiteDomain(website: string | null): string | null {
	if (!website?.trim()) return null;
	try {
		const url = new URL(/^[a-z]+:\/\//i.test(website) ? website : `https://${website.trim()}`);
		return url.hostname.toLowerCase().replace(/^www\./, '') || null;
	} catch {
		return null;
	}
}

/** Live organizations sharing a website domain: likely one, never merged on their own. */
export async function listOrganizationMergeSuggestions() {
	const rows = await db
		.select({
			id: organization.id,
			name: organization.name,
			website: organization.website
		})
		.from(organization)
		.where(isNull(organization.archivedAt))
		.orderBy(asc(organization.createdAt), asc(organization.id));
	const groups = new Map<string, typeof rows>();
	for (const r of rows) {
		const domain = websiteDomain(r.website);
		if (!domain) continue;
		groups.set(domain, [...(groups.get(domain) ?? []), r]);
	}
	return [...groups.entries()]
		.filter(([, list]) => list.length > 1)
		.map(([domain, organizations]) => ({ domain, organizations }));
}

/**
 * Fold `otherId` into `survivorId`: its roles, records, contractor and vendor
 * detail and logo move over where the survivor lacks them, its notes are kept, and it is
 * deleted. Its people move first, through `contact-service.ts`.
 */
export async function mergeOrganizations(survivorId: string, otherId: string) {
	if (survivorId === otherId) throw new OrganizationMergeError();
	const [survivor, other] = await Promise.all([
		getOrganization(survivorId),
		getOrganization(otherId)
	]);
	const [[survivorDetail], [survivorVendor], [survivorLogo]] = await Promise.all([
		db
			.select({ id: contractorDetail.organizationId })
			.from(contractorDetail)
			.where(eq(contractorDetail.organizationId, survivorId)),
		db
			.select({ id: vendorDetail.organizationId })
			.from(vendorDetail)
			.where(eq(vendorDetail.organizationId, survivorId)),
		db.select({ id: mediaAttachment.id }).from(mediaAttachment).where(logoOf(survivorId))
	]);
	const notes = [survivor.notes, other.notes && `From ${other.name}: ${other.notes}`]
		.filter(Boolean)
		.join('\n');
	const moveTo = { organizationId: survivorId, updatedAt: new Date() };

	await db.batch([
		db
			.update(organization)
			.set({
				website: survivor.website ?? other.website,
				notes: notes || null,
				updatedAt: new Date()
			})
			.where(eq(organization.id, survivorId)),
		...other.roles.map((role) =>
			db.insert(partyRole).values({ organizationId: survivorId, role }).onConflictDoNothing()
		),
		...ORGANIZATION_RECORDS.map((t) =>
			db.update(t).set(moveTo).where(eq(t.organizationId, otherId))
		),
		// Its tasks and notes come too; the delete below takes the old links.
		copyLinks('organizationId', otherId, survivorId),
		moveActivity({ type: 'organization', id: otherId }, { type: 'organization', id: survivorId }),
		moveThreads({ type: 'organization', id: otherId }, { type: 'organization', id: survivorId }),
		...(survivorDetail
			? []
			: [
					db
						.update(contractorDetail)
						.set({ organizationId: survivorId })
						.where(eq(contractorDetail.organizationId, otherId))
				]),
		...(survivorVendor
			? []
			: [
					db
						.update(vendorDetail)
						.set({ organizationId: survivorId })
						.where(eq(vendorDetail.organizationId, otherId))
				]),
		...(survivorLogo
			? []
			: [db.update(mediaAttachment).set({ attachableId: survivorId }).where(logoOf(otherId))]),
		// The directory link is unique, so it moves only after the other row lets go.
		db.delete(organization).where(eq(organization.id, otherId)),
		...(survivor.directoryEntryId || !other.directoryEntryId
			? []
			: [
					db
						.update(organization)
						.set({ directoryEntryId: other.directoryEntryId })
						.where(eq(organization.id, survivorId))
				])
	]);
	return { survivor: survivor.name, other: other.name };
}

const logoOf = (id: string) =>
	and(
		eq(mediaAttachment.attachableType, 'organization'),
		eq(mediaAttachment.attachableId, id),
		eq(mediaAttachment.slot, 'logo')
	);
