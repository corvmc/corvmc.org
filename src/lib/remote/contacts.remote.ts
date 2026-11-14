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
import * as notes from '#lib/server/party/activity-service.js';
import type { PartyRef } from '#lib/server/party/activity-service.js';
import { partyTimeline } from '#lib/server/party/timeline.js';
import { listContacts } from '#lib/server/party/contact-list.js';
import { recordInKindGift } from '#lib/server/finance/in-kind-gift.js';
import { listFundableProjects } from '#lib/server/development/funding-project.js';
import {
	ACTIVITY_BODY_MAX,
	activityKinds,
	contactListSorts,
	contactListTypes,
	LONG_TEXT_MAX,
	MARKET_MAX_TABLES_REQUESTED,
	partyRoles,
	SHORT_TEXT_MAX,
	type PartyRole
} from '#lib/config.js';

/**
 * The Contacts screens (#2622): every outside organization, its roles and its
 * people. A role's own capability opens that role's organizations in the list
 * and their pages, so the treasurer still reaches contractors and sponsors.
 * The people on them need `contact.read`.
 */

/** The roles whose organizations this viewer may read; `all` to contact.read, role-less ones included. */
async function visibleRoles(): Promise<PartyRole[] | 'all'> {
	if (await can('contact.read')) return 'all';
	const roles: PartyRole[] = [];
	for (const role of partyRoles) if (await canSeeRole(role)) roles.push(role);
	return roles;
}

/**
 * One table of every organization the viewer may read and, to contact.read,
 * every person with no organization (#2760). Role filters outside the viewer's
 * roles drop away; with no role at all, the page is refused. A sort on a
 * column the viewer may not see falls back to name.
 */
export const getContactsPage = query(
	z.object({
		roles: z.array(z.enum(partyRoles)).max(partyRoles.length).optional(),
		type: z.enum(contactListTypes).optional(),
		search: z.string().max(SHORT_TEXT_MAX).optional(),
		includeArchived: z.boolean().optional(),
		sort: z.enum(contactListSorts).optional(),
		page: z.number().int().positive().optional()
	}),
	async (filters) => {
		await requireUser();
		const visible = await visibleRoles();
		if (visible !== 'all' && visible.length === 0) error(403, 'Forbidden');
		const [staff, tasks] = await Promise.all([can('contact.read'), can('project.read')]);
		// The notes need `contact.read`; the task, the Tasks table's own `project.read`.
		const sortable = { name: true, activity: staff, task: tasks };
		const requested = filters.sort ?? 'name';
		const sort = sortable[requested.replace(/^-/, '') as keyof typeof sortable]
			? requested
			: 'name';
		const roles =
			visible === 'all' ? filters.roles : filters.roles?.filter((r) => visible.includes(r));
		const list = await listContacts({
			visibleRoles: visible,
			people: staff,
			roles,
			type: filters.type,
			search: filters.search,
			includeArchived: filters.includeArchived,
			sort,
			page: filters.page
		});
		return {
			roles: visible === 'all' ? [...partyRoles] : visible,
			people: staff,
			sort,
			sortable,
			rows: list.rows.map((r) => ({
				type: r.type,
				id: r.id,
				name: r.name,
				website: r.website,
				roles: r.roles,
				archivedAt: r.archivedAt,
				mainPerson: r.mainPerson,
				lastActivity: staff ? r.lastActivity : null,
				nextTask: tasks ? r.nextTask : null
			})),
			pagination: list.pagination
		};
	}
);

export const getOrganizationPage = query(z.string().min(1), async (id) => {
	const org = await requireOrganizationReader(id);
	try {
		const act = org.roles.includes('performer') ? org.directoryEntryId : null;
		const [records, contractor, vendor, staff, manage, recordGift, shows, claim, sheet] =
			await Promise.all([
				orgs.organizationRecords(id),
				org.roles.includes('contractor') ? getContractorById(id).catch(() => null) : null,
				org.roles.includes('vendor') ? orgs.getVendorDetail(id) : null,
				can('contact.read'),
				can('contact.manage'),
				can('finance.refund'),
				// An act's shows carry its deal and pay: the events staff's read.
				can('event.read'),
				act ? can('event.manage') : false,
				act ? can('directory.shareContactSheet') : false
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
			vendor: vendor && {
				offering: vendor.offering,
				tablesNeeded: vendor.tablesNeeded,
				needsPower: vendor.needsPower,
				bringsOwnTable: vendor.bringsOwnTable,
				bringsTent: vendor.bringsTent,
				setupNotes: vendor.setupNotes
			},
			records: { ...records, shows: shows ? records.shows : [] },
			act: act ? { entryId: act, canClaim: claim, canSendContactSheet: sheet } : null,
			people: staff ? await people.listPeople(id) : null,
			canManage: manage,
			canRecordGift: recordGift
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

/** A vendor's standing tabling needs, which a new application falls back on. */
export const saveVendorDetail = form(
	z.object({
		id: z.string().min(1),
		offering: optionalText(LONG_TEXT_MAX),
		tablesNeeded: z.number().int().min(1).max(MARKET_MAX_TABLES_REQUESTED),
		needsPower: z.boolean().optional(),
		bringsOwnTable: z.boolean().optional(),
		bringsTent: z.boolean().optional(),
		setupNotes: optionalText(LONG_TEXT_MAX)
	}),
	async (data) => {
		await requireCapability('contact.manage');
		try {
			await orgs.saveVendorDetail(data.id, {
				offering: data.offering || null,
				tablesNeeded: data.tablesNeeded,
				needsPower: data.needsPower ?? false,
				bringsOwnTable: data.bringsOwnTable ?? false,
				bringsTent: data.bringsTent ?? false,
				setupNotes: data.setupNotes || null
			});
		} catch (err) {
			mapDomainError(err);
		}
		await getOrganizationPage(data.id).refresh();
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
			contractor: records.jobs.length,
			supplier: records.orders.length,
			vendor: records.markets.length,
			performer: records.bands.length
		} as Partial<Record<PartyRole, number>>;
		await orgs.removeRole(data.id, data.role, inUse[data.role] ?? 0);
		await getOrganizationPage(data.id).refresh();
		return { success: true };
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

/** One person's page: their details, organization and roles. */
export const getPersonPage = query(z.string().min(1), async (id) => {
	await requireCapability('contact.read');
	const [person, manage, recordGift] = await Promise.all([
		people.getPerson(id),
		can('contact.manage'),
		can('finance.refund')
	]);
	return { ...person, canManage: manage, canRecordGift: recordGift };
});

// ----------------------------------------------------------------- timeline

const party = z.object({ type: z.enum(['organization', 'contact']), id: z.string().min(1) });

/** Notes need `contact.read`; an organization's also need its page's own guard. */
async function requirePartyReader(p: PartyRef) {
	await requireCapability('contact.read');
	if (p.type === 'organization') await requireOrganizationReader(p.id);
}

/** A party's timeline, newest first (#2622). "Show older" asks again with a longer `limit`. */
export const getPartyTimeline = query(
	party.extend({ limit: z.number().int().positive().optional() }),
	async ({ limit, ...p }) => {
		await requirePartyReader(p);
		return partyTimeline(p, { limit });
	}
);

const note = {
	kind: z.enum(activityKinds),
	occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the day it happened'),
	body: z.string().trim().min(1, 'Say what happened').max(ACTIVITY_BODY_MAX)
};

export const addActivityForm = form(
	z.object({ partyType: party.shape.type, partyId: party.shape.id, ...note }),
	async ({ partyType, partyId, ...input }) => {
		const staff = await requireCapability('contact.manage');
		const p = { type: partyType, id: partyId };
		await requirePartyReader(p);
		await notes.addActivity(p, input, staff.id);
		void getPartyTimeline(p).refresh();
		return { success: true };
	}
);

export const updateActivityForm = form(
	z.object({ id: z.string().min(1), ...note }),
	async ({ id, ...input }) => {
		await requireCapability('contact.manage');
		const p = await notes.updateActivity(id, input);
		void getPartyTimeline(p).refresh();
		return { success: true };
	}
);

export const deleteActivityForm = form(z.object({ id: z.string().min(1) }), async ({ id }) => {
	await requireCapability('contact.manage');
	const p = await notes.deleteActivity(id);
	void getPartyTimeline(p).refresh();
	return { success: true };
});

// ----------------------------------------------------------- in-kind gifts

/** What a gift can be booked against, for the record form's picker. */
export const getGiftProjects = query(async () => {
	await requireCapability('finance.refund');
	return listFundableProjects();
});

/** An in-kind gift from this party, as an `in_kind` ledger entry (#2727). */
export const recordGiftForm = form(
	z.object({
		partyType: party.shape.type,
		partyId: party.shape.id,
		description: z.string().trim().min(1, 'Say what was given').max(SHORT_TEXT_MAX),
		valueCents: z.number().int().positive('Enter its fair value'),
		occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the day it was given'),
		projectId: z.string().optional()
	}),
	async ({ partyType, partyId, ...input }) => {
		const staff = await requireCapability('finance.refund');
		const p = { type: partyType, id: partyId };
		await requirePartyReader(p);
		try {
			if (p.type === 'contact') await people.getPerson(p.id);
			await recordInKindGift(p, input, staff.id);
		} catch (err) {
			mapDomainError(err);
		}
		void getPartyTimeline(p).refresh();
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
