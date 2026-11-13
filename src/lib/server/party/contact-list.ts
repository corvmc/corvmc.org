import { db } from '#lib/server/db/index.js';
import { organization } from '#lib/server/db/schema/party.js';
import { partyRole } from '#lib/server/db/schema/contact.js';
import { and, inArray, isNotNull, isNull } from 'drizzle-orm';
import * as people from '#lib/server/directory/contact-service.js';
import type { PaginatedResult } from '#lib/server/db/paginate.js';
import type { ContactListSort, ContactListType, PartyRole } from '#lib/config.js';
import { partyListFacts, type NextTask } from './list-facts';
import { partyKey } from './party-key';

/**
 * The Contacts list (#2760): every organization the viewer may read and every
 * person with no organization, filtered, sorted and paged here so a page holds
 * the right rows. No guards: the remote decides `visibleRoles` and `people`,
 * and the people readers guard themselves with `contact.read`.
 */

export interface ContactListInput {
	/** The roles whose organizations the viewer may read; `all` takes role-less ones too. */
	visibleRoles: readonly PartyRole[] | 'all';
	/** Whether the viewer may read people: the main person and the person rows. */
	people: boolean;
	/** Any of these roles. Empty or absent is every visible role. */
	roles?: readonly PartyRole[];
	type?: ContactListType;
	/** Matches name, main person and website. */
	search?: string;
	includeArchived?: boolean;
	sort?: ContactListSort;
	page?: number;
	pageSize?: number;
}

export interface ContactListRow {
	type: ContactListType;
	id: string;
	name: string | null;
	website: string | null;
	roles: PartyRole[];
	archivedAt: Date | null;
	mainPerson: string | null;
	lastActivity: string | null;
	nextTask: NextTask | null;
}

/** Organizations in any of `roles` (null: no role filter), archived ones on request. */
async function organizations(roles: readonly PartyRole[] | null, includeArchived: boolean) {
	if (roles && roles.length === 0) return [];
	// Read whole rather than bound per id: D1 caps a statement at 100 parameters.
	const [rows, held] = await Promise.all([
		db
			.select({
				id: organization.id,
				name: organization.name,
				website: organization.website,
				archivedAt: organization.archivedAt
			})
			.from(organization)
			.where(
				and(
					includeArchived ? undefined : isNull(organization.archivedAt),
					roles
						? inArray(
								organization.id,
								db
									.select({ id: partyRole.organizationId })
									.from(partyRole)
									.where(inArray(partyRole.role, [...roles]))
							)
						: undefined
				)
			),
		db
			.select({ organizationId: partyRole.organizationId, role: partyRole.role })
			.from(partyRole)
			.where(isNotNull(partyRole.organizationId))
	]);
	const byOrg = new Map<string, PartyRole[]>();
	for (const r of held) {
		byOrg.set(r.organizationId!, [...(byOrg.get(r.organizationId!) ?? []), r.role]);
	}
	return rows.map((r) => ({ ...r, roles: byOrg.get(r.id) ?? [] }));
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Missing values sort last whichever way the column runs; ties go by name. */
function compare(sort: ContactListSort) {
	const desc = sort.startsWith('-');
	const key = sort.replace(/^-/, '') as 'name' | 'activity' | 'task';
	const byName = (a: ContactListRow, b: ContactListRow) =>
		collator.compare(a.name ?? '', b.name ?? '') || a.id.localeCompare(b.id);
	const valueOf = (r: ContactListRow): string | number | null =>
		key === 'activity' ? r.lastActivity : (r.nextTask?.dueAt?.getTime() ?? null);
	return (a: ContactListRow, b: ContactListRow) => {
		if (key === 'name') return desc ? byName(b, a) : byName(a, b);
		const [x, y] = [valueOf(a), valueOf(b)];
		if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
		const order = x < y ? -1 : x > y ? 1 : 0;
		return (desc ? -order : order) || byName(a, b);
	};
}

export async function listContacts(
	input: ContactListInput
): Promise<PaginatedResult<ContactListRow>> {
	const { page = 1, pageSize = 50, sort = 'name' } = input;
	const visible = input.visibleRoles;
	const wanted = input.roles?.length ? input.roles : null;
	const orgRoles =
		visible === 'all' ? wanted : wanted ? wanted.filter((r) => visible.includes(r)) : visible;
	const withPeople = input.people && input.type !== 'organization';

	const [orgs, loose, main, facts] = await Promise.all([
		input.type === 'person' ? [] : organizations(orgRoles, input.includeArchived ?? false),
		withPeople ? people.listUnaffiliatedPeople() : [],
		input.people ? people.allPrimaryContacts() : new Map<string, people.PrimaryContact>(),
		partyListFacts()
	]);

	const factsFor = (key: string) => ({
		lastActivity: facts.lastActivity.get(key) ?? null,
		nextTask: facts.nextTask.get(key) ?? null
	});
	const rows: ContactListRow[] = [
		...orgs.map((o) => {
			const person = main.get(o.id);
			return {
				type: 'organization' as const,
				...o,
				mainPerson: person?.name ?? person?.email ?? null,
				...factsFor(partyKey({ type: 'organization', id: o.id }))
			};
		}),
		...loose
			.filter((p) => !wanted || p.roles.some((r) => wanted.includes(r)))
			.map((p) => ({
				type: 'person' as const,
				id: p.id,
				name: p.name ?? p.email,
				website: null,
				roles: p.roles,
				archivedAt: null,
				mainPerson: null,
				...factsFor(partyKey({ type: 'contact', id: p.id }))
			}))
	];

	const q = input.search?.trim().toLowerCase();
	const matched = q
		? rows.filter((r) =>
				[r.name, r.mainPerson, r.website].some((v) => v?.toLowerCase().includes(q))
			)
		: rows;
	matched.sort(compare(sort));

	const total = matched.length;
	return {
		rows: matched.slice((page - 1) * pageSize, page * pageSize),
		pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
	};
}
