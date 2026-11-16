/**
 * A contractor for a `migratedSqlite()` spec: an organization, its
 * `contractor` role and its detail row (#2622). One helper so a spec that
 * needs somebody to engage does not restate the three tables.
 */
export function contractorSql(id: string, name: string, trade = 'electrical'): string {
	const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
	return `
		insert into organization (id, name) values (${q(id)}, ${q(name)});
		insert into party_role (id, organization_id, role) values (${q(`${id}:contractor`)}, ${q(id)}, 'contractor');
		insert into contractor_detail (organization_id, trade) values (${q(id)}, ${q(trade)});
	`;
}

/** Every organization and what hangs off it, with foreign keys off or on. */
export const clearOrganizationsSql = `
	delete from contractor_detail;
	delete from party_role;
	delete from organization;
`;
