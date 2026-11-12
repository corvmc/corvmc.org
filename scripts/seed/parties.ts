import { organization, contractorDetail } from '../../src/lib/server/db/schema/party';
// Seed data writes fixtures and never reads one back for a client, which is
// what the rule guards against.
// eslint-disable-next-line custom/no-contact-schema-imports
import { contact, partyRole } from '../../src/lib/server/db/schema/contact';
import type { ContractorTrade, PartyRole } from '../../src/lib/config';
import { batchInsert } from './db';

/** One outside organization, its roles, and the person to ask for there. */
export type SeedOrganization = {
	id: string;
	name: string;
	roles: PartyRole[];
	website?: string | null;
	notes?: string | null;
	archivedAt?: Date | null;
	person?: { name?: string; role?: string; email?: string; phone?: string };
	contractor?: {
		trade: ContractorTrade;
		licenseNumber?: string | null;
		insuranceExpiresAt?: Date | null;
	};
};

/**
 * Insert organizations with their roles, people and contractor detail. A
 * person's email is stored lower-cased, as `contact-service.ts` writes it.
 */
export async function seedOrganizations(orgs: SeedOrganization[]) {
	await batchInsert(
		organization,
		orgs.map((o) => ({
			id: o.id,
			name: o.name,
			website: o.website ?? null,
			notes: o.notes ?? null,
			archivedAt: o.archivedAt ?? null
		}))
	);
	await batchInsert(
		partyRole,
		orgs.flatMap((o) => o.roles.map((role) => ({ organizationId: o.id, role })))
	);
	const people = orgs.filter((o) => o.person);
	if (people.length > 0) {
		await batchInsert(
			contact,
			people.map((o) => ({
				organizationId: o.id,
				name: o.person!.name ?? null,
				role: o.person!.role ?? null,
				email: o.person!.email?.toLowerCase() ?? null,
				phone: o.person!.phone ?? null,
				source: 'staff_entered' as const
			}))
		);
	}
	const contractors = orgs.filter((o) => o.contractor);
	if (contractors.length > 0) {
		await batchInsert(
			contractorDetail,
			contractors.map((o) => ({ organizationId: o.id, ...o.contractor! }))
		);
	}
}
