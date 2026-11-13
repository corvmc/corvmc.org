import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { can, requireCapability, requireUser } from '#lib/server/authorization.js';
import { mapDomainError } from '#lib/server/errors.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import * as orgs from '#lib/server/party/organization-service.js';
import * as people from '#lib/server/directory/contact-service.js';
import { getContractorById } from '#lib/server/contractor/contractor-service.js';
import { canSeeRole, requireOrganizationReader } from '#lib/server/party/organization-guard.js';
import { LONG_TEXT_MAX, partyRoles, SHORT_TEXT_MAX, type PartyRole } from '#lib/config.js';

/**
 * The Contacts screens (#2622): every outside organization, its roles and its
 * people. A role's own capability opens that role's view and its
 * organizations' pages, so the treasurer still reaches contractors and
 * sponsors. The people on them need `contact.read`.
 */

const view = z.enum(['all', ...partyRoles]);
export type ContactsView = z.infer<typeof view>;

/** The views this viewer may open, for the tab bar. */
async function viewsFor() {
	const all = await can('contact.read');
	const roles: PartyRole[] = [];
	for (const role of partyRoles) if (all || (await canSeeRole(role))) roles.push(role);
	return { all, roles };
}

/**
 * The list, with the views the viewer may open. A view they may not open falls
 * back to the first one they may; with none, the page is refused.
 */
export const getContactsPage = query(
	z.object({ view: view.optional(), includeArchived: z.boolean().optional() }),
	async ({ view: requested, includeArchived }) => {
		await requireUser();
		const views = await viewsFor();
		const allowed: ContactsView[] = [...(views.all ? ['all' as const] : []), ...views.roles];
		const view = requested && allowed.includes(requested) ? requested : allowed[0];
		if (!view) error(403, 'Forbidden');
		const list = await orgs.listOrganizations({
			role: view === 'all' ? undefined : view,
			includeArchived: includeArchived ?? false
		});
		const main = (await can('contact.read'))
			? await people.primaryContacts(list.map((r) => r.id))
			: new Map();
		const rows = list.map((r) => ({
			id: r.id,
			name: r.name,
			website: r.website,
			roles: r.roles,
			archivedAt: r.archivedAt,
			mainPerson: main.get(r.id)?.name ?? main.get(r.id)?.email ?? null
		}));
		return { views, view, rows };
	}
);

export const getOrganizationPage = query(z.string().min(1), async (id) => {
	const org = await requireOrganizationReader(id);
	try {
		const [records, contractor, staff, manage] = await Promise.all([
			orgs.organizationRecords(id),
			org.roles.includes('contractor') ? getContractorById(id).catch(() => null) : null,
			can('contact.read'),
			can('contact.manage')
		]);
		return {
			id: org.id,
			name: org.name,
			website: org.website,
			notes: org.notes,
			archivedAt: org.archivedAt,
			roles: org.roles,
			contractor: contractor && {
				trade: contractor.trade,
				licenseNumber: contractor.licenseNumber,
				insuranceExpiresAt: contractor.insuranceExpiresAt
			},
			records,
			people: staff ? await people.listPeople(id) : null,
			canManage: manage
		};
	} catch (err) {
		mapDomainError(err);
	}
});

// ------------------------------------------------------------ organizations

const optionalText = (max: number) => z.string().max(max).optional();
const organizationFields = {
	name: z.string().trim().min(1, 'Name the organization').max(SHORT_TEXT_MAX),
	website: optionalText(SHORT_TEXT_MAX),
	notes: optionalText(LONG_TEXT_MAX)
};

function organizationInput(d: { name: string; website?: string; notes?: string }) {
	return { name: d.name, website: d.website || null, notes: d.notes || null };
}

export const createOrganization = form(
	z.object({ ...organizationFields, role: z.enum(partyRoles) }),
	async (data) => {
		await requireCapability('contact.manage');
		if (data.role === 'contractor') {
			invalidRole();
		}
		const row = await orgs.createOrganization(organizationInput(data), [data.role]);
		return { id: row.id };
	}
);

/** A contractor needs a trade, so it is added from the Contractors page. */
function invalidRole(): never {
	error(422, 'Add a contractor from the Contractors page, which asks for their trade.');
}

export const updateOrganization = form(
	z.object({ id: z.string().min(1), ...organizationFields }),
	async (data) => {
		await requireCapability('contact.manage');
		await orgs.updateOrganization(data.id, organizationInput(data));
		await getOrganizationPage(data.id).refresh();
		return { success: true };
	}
);

export const archiveOrganization = form(
	z.object({ id: z.string().min(1), archived: z.boolean().optional().default(false) }),
	async (raw) => {
		await requireCapability('contact.manage');
		const { id, archived } = raw as { id: string; archived: boolean };
		await orgs.setOrganizationArchived(id, archived);
		await getOrganizationPage(id).refresh();
		return { success: true };
	}
);

export const addOrganizationRole = form(
	z.object({ id: z.string().min(1), role: z.enum(partyRoles) }),
	async (data) => {
		await requireCapability('contact.manage');
		if (data.role === 'contractor') invalidRole();
		await orgs.addRole(data.id, data.role);
		await getOrganizationPage(data.id).refresh();
		return { success: true };
	}
);

export const removeOrganizationRole = form(
	z.object({ id: z.string().min(1), role: z.enum(partyRoles) }),
	async (data) => {
		await requireCapability('contact.manage');
		const records = await orgs.organizationRecords(data.id);
		const inUse = {
			funder: records.grants.length,
			sponsor: records.sponsorships.length,
			contractor: records.jobs.length
		} as Partial<Record<PartyRole, number>>;
		const deleted = await orgs.removeRole(data.id, data.role, inUse[data.role] ?? 0);
		if (!deleted) await getOrganizationPage(data.id).refresh();
		return { success: true, deleted };
	}
);

// ------------------------------------------------------------------- people

const personFields = {
	name: z.string().trim().min(1, 'Name the person').max(SHORT_TEXT_MAX),
	role: optionalText(SHORT_TEXT_MAX),
	email: z.union([z.literal(''), z.email('Enter a valid email, or leave it blank')]).optional(),
	phone: optionalText(SHORT_TEXT_MAX),
	notes: optionalText(LONG_TEXT_MAX)
};

export const addPerson = form(
	z.object({ organizationId: z.string().min(1), ...personFields }),
	async (data) => {
		await requireCapability('contact.manage');
		const result = await people.createContact(data);
		await getOrganizationPage(data.organizationId).refresh();
		return { success: true, merged: result.merged };
	}
);

export const updatePerson = form(
	z.object({ id: z.string().min(1), organizationId: z.string().min(1), ...personFields }),
	async ({ id, organizationId, ...data }) => {
		await requireCapability('contact.manage');
		await people.updateContact(id, data);
		await getOrganizationPage(organizationId).refresh();
		return { success: true };
	}
);

export const removePerson = form(
	z.object({ id: z.string().min(1), organizationId: z.string().min(1) }),
	async (data) => {
		await requireCapability('contact.manage');
		await people.deleteContact(data.id);
		await getOrganizationPage(data.organizationId).refresh();
		return { success: true };
	}
);

// --------------------------------------------------------------- duplicates

export const getDuplicates = query(async () => {
	await requireCapability('contact.read');
	const [contacts, organizations, names] = await Promise.all([
		people.listContactMergeSuggestions(),
		orgs.listOrganizationMergeSuggestions(),
		orgs.listOrganizations({ includeArchived: true })
	]);
	const nameOf = new Map(names.map((o) => [o.id, o.name]));
	return {
		contacts: contacts.map((g) => ({
			reason: g.reason,
			people: g.people.map((p) => ({
				...p,
				organization: p.organizationId ? (nameOf.get(p.organizationId) ?? null) : null
			}))
		})),
		organizations
	};
});

const pair = z.object({ survivorId: z.string().min(1), otherId: z.string().min(1) });

export const mergePeople = form(pair, async (data) => {
	await requireCapability('contact.manage');
	const name = await people.mergeContacts(data.survivorId, data.otherId);
	await recordAuditEntry({
		action: 'contact.merged',
		subject: { type: 'contact', id: data.survivorId, label: name ?? 'Contact' },
		details: { mergedId: data.otherId }
	});
	await getDuplicates().refresh();
	return { success: true };
});

export const mergeOrganizations = form(pair, async (data) => {
	await requireCapability('contact.manage');
	await orgs.getOrganization(data.survivorId);
	await people.moveOrganizationPeople(data.otherId, data.survivorId);
	const names = await orgs.mergeOrganizations(data.survivorId, data.otherId);
	await recordAuditEntry({
		action: 'organization.merged',
		subject: { type: 'organization', id: data.survivorId, label: names.survivor },
		details: { mergedId: data.otherId, mergedName: names.other }
	});
	await getDuplicates().refresh();
	return { success: true };
});
