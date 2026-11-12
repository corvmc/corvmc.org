import { db } from '#lib/server/db/index.js';
import { contractorDetail, organization } from '#lib/server/db/schema/party.js';
import { partyRole } from '#lib/server/db/schema/contact.js';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import type { ContractorTrade } from '#lib/config.js';
import {
	addRole,
	createOrganization,
	setOrganizationArchived,
	updateOrganization
} from '#lib/server/party/organization-service.js';

/**
 * The people the collective pays to do work.
 *
 * A contractor is an organization holding the `contractor` role, with a
 * `contractor_detail` row for its trade and paperwork (#2622). The interesting
 * object is still the job; what a report wants to know is a question about
 * jobs that happens to group by this.
 */

export class ContractorNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Contractor not found');
	}
}

export interface ContractorInput {
	name: string;
	trade: ContractorTrade;
	website?: string | null;
	licenseNumber?: string | null;
	insuranceExpiresAt?: Date | null;
	notes?: string | null;
}

const contractorColumns = {
	id: organization.id,
	name: organization.name,
	website: organization.website,
	notes: organization.notes,
	archivedAt: organization.archivedAt,
	trade: contractorDetail.trade,
	licenseNumber: contractorDetail.licenseNumber,
	insuranceExpiresAt: contractorDetail.insuranceExpiresAt
};

/** Organizations holding `contractor`, with their detail row. */
function contractorQuery() {
	return db
		.select(contractorColumns)
		.from(organization)
		.innerJoin(
			partyRole,
			and(eq(partyRole.organizationId, organization.id), eq(partyRole.role, 'contractor'))
		)
		.innerJoin(contractorDetail, eq(contractorDetail.organizationId, organization.id));
}

export type Contractor = Awaited<ReturnType<typeof getContractorById>>;

function detailOf(data: Partial<ContractorInput>) {
	return {
		...(data.trade !== undefined && { trade: data.trade }),
		...(data.licenseNumber !== undefined && { licenseNumber: data.licenseNumber }),
		...(data.insuranceExpiresAt !== undefined && { insuranceExpiresAt: data.insuranceExpiresAt })
	};
}

/**
 * Make a contractor. With `organizationId`, an existing organization (a
 * sponsor, say) takes on the role rather than being entered twice.
 */
export async function createContractor(data: ContractorInput, organizationId?: string) {
	let id = organizationId;
	if (id) {
		await addRole(id, 'contractor');
	} else {
		const org = await createOrganization(
			{ name: data.name, website: data.website ?? null, notes: data.notes ?? null },
			['contractor']
		);
		id = org.id;
	}
	await db
		.insert(contractorDetail)
		.values({ organizationId: id, trade: data.trade, ...detailOf(data) })
		.onConflictDoUpdate({
			target: contractorDetail.organizationId,
			set: { ...detailOf(data), updatedAt: new Date() }
		});
	return getContractorById(id);
}

export async function updateContractor(id: string, data: Partial<ContractorInput>) {
	const current = await getContractorById(id);
	await updateOrganization(id, {
		name: data.name ?? current.name,
		website: data.website !== undefined ? data.website : current.website,
		notes: data.notes !== undefined ? data.notes : current.notes
	});
	const detail = detailOf(data);
	if (Object.keys(detail).length > 0) {
		await db
			.update(contractorDetail)
			.set({ ...detail, updatedAt: new Date() })
			.where(eq(contractorDetail.organizationId, id));
	}
	return getContractorById(id);
}

/**
 * Retire someone from the pickers without pretending they never worked here.
 * `contractor_job.organization_id` restricts deletion, so this is the way out
 * for anyone with history.
 */
export async function archiveContractor(id: string, archived = true) {
	await getContractorById(id);
	await setOrganizationArchived(id, archived);
	return getContractorById(id);
}

export async function getContractorById(id: string) {
	const [row] = await contractorQuery().where(eq(organization.id, id)).limit(1);
	if (!row) throw new ContractorNotFoundError();
	return row;
}

export async function listContractors(
	opts: { trade?: ContractorTrade; includeArchived?: boolean } = {}
) {
	return contractorQuery()
		.where(
			and(
				opts.trade ? eq(contractorDetail.trade, opts.trade) : undefined,
				opts.includeArchived ? undefined : isNull(organization.archivedAt)
			)
		)
		.orderBy(asc(organization.name));
}

/**
 * Whose certificate of insurance has lapsed, or lapses within `days`.
 *
 * Derived from the date every time rather than stored. Contractors we hold no
 * certificate for are not included: null is "we never asked", which wants a
 * different prompt from "it ran out".
 */
export async function listLapsingInsurance(days = 30, now: Date = new Date()) {
	const horizon = new Date(now.getTime() + days * 86_400_000);

	return contractorQuery()
		.where(
			and(
				isNull(organization.archivedAt),
				sql`${contractorDetail.insuranceExpiresAt} is not null`,
				sql`${contractorDetail.insuranceExpiresAt} <= ${Math.floor(horizon.getTime() / 1000)}`
			)
		)
		.orderBy(asc(contractorDetail.insuranceExpiresAt));
}
