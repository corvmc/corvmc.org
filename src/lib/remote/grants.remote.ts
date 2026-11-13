import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '#lib/server/authorization.js';
import { mapDomainError } from '#lib/server/errors.js';
import * as grants from '#lib/server/grant/grant-service.js';
import * as funders from '#lib/server/grant/funder-service.js';
import { savePrimaryContact, withPrimaryContact } from '#lib/server/party/primary-contact.js';
import { listFundableProjects } from '#lib/server/development/funding-project.js';
import {
	clubToday,
	grantStages,
	grantStatuses,
	LONG_TEXT_MAX,
	SHORT_TEXT_MAX
} from '#lib/config.js';

/** An `<input type="date">` value, or blank for "no date". */
const isoDay = z
	.string()
	.regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Pick a date')
	.optional();
const optionalText = (max: number) => z.string().max(max).optional();
// A cleared money field is dropped from the payload, not sent as null.
const optionalCents = z.number().int().min(0).optional();

// ------------------------------------------------------------------- funders

const funderFields = {
	name: z.string().trim().min(1, 'Name the funder').max(SHORT_TEXT_MAX),
	website: optionalText(SHORT_TEXT_MAX),
	contactName: optionalText(SHORT_TEXT_MAX),
	contactEmail: optionalText(SHORT_TEXT_MAX),
	notes: optionalText(LONG_TEXT_MAX)
};

function funderInput(d: z.infer<z.ZodObject<typeof funderFields>>) {
	return {
		name: d.name,
		website: d.website || null,
		notes: d.notes || null
	};
}

function funderContact(d: z.infer<z.ZodObject<typeof funderFields>>) {
	return { contactName: d.contactName || null, contactEmail: d.contactEmail || null };
}

export const getFunders = query(
	z.object({ includeArchived: z.boolean().optional() }).optional(),
	async (filters) => {
		await requireCapability('grant.read');
		const rows = await funders.listFunders({
			includeArchived: filters?.includeArchived ?? false
		});
		return withPrimaryContact(rows);
	}
);

export const createFunder = form(z.object(funderFields), async (data) => {
	await requireCapability('grant.manage');
	const row = await funders.createFunder(funderInput(data));
	await savePrimaryContact(row.id, funderContact(data));
	return { id: row.id };
});

export const updateFunder = form(
	z.object({ id: z.string().min(1), ...funderFields }),
	async (data) => {
		await requireCapability('grant.manage');
		try {
			await funders.updateFunder(data.id, funderInput(data));
			await savePrimaryContact(data.id, funderContact(data));
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const archiveFunder = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('grant.manage');
	try {
		await funders.archiveFunder(data.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const restoreFunder = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('grant.manage');
	try {
		await funders.restoreFunder(data.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const deleteFunder = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('grant.manage');
	try {
		await funders.deleteFunder(data.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

// ------------------------------------------------------------- applications

const grantFields = {
	funderId: z.string().min(1, 'Pick a funder'),
	title: z.string().trim().min(1, 'Give it a name').max(SHORT_TEXT_MAX),
	status: z.enum(grantStatuses),
	amountRequestedCents: optionalCents,
	amountAwardedCents: optionalCents,
	applyBy: isoDay,
	startsOn: isoDay,
	endsOn: isoDay,
	notes: optionalText(LONG_TEXT_MAX),
	/** Blank for general operating support. */
	fundsProjectId: z.string().optional()
};

function grantInput(d: z.infer<z.ZodObject<typeof grantFields>>) {
	return {
		organizationId: d.funderId,
		title: d.title,
		status: d.status,
		amountRequestedCents: d.amountRequestedCents ?? null,
		amountAwardedCents: d.amountAwardedCents ?? null,
		applyBy: d.applyBy || null,
		startsOn: d.startsOn || null,
		endsOn: d.endsOn || null,
		notes: d.notes || null,
		fundsProjectId: d.fundsProjectId || null
	};
}

export const getGrantDetail = query(z.string(), async (id) => {
	await requireCapability('grant.read');
	try {
		const grant = await grants.getGrant(id, clubToday());
		const [funderRows, projects] = await Promise.all([
			funders.listFunders({ includeArchived: true }),
			listFundableProjects([grant.fundsProjectId])
		]);
		// An archived funder stays pickable on the application that already names it.
		const pickable = funderRows.filter((f) => !f.archivedAt || f.id === grant.funderId);
		return { ...grant, funders: pickable.map((f) => ({ id: f.id, name: f.name })), projects };
	} catch (err) {
		mapDomainError(err);
	}
});

export const createGrant = form(z.object(grantFields), async (data) => {
	const staff = await requireCapability('grant.manage');
	try {
		const row = await grants.createGrant(grantInput(data), { createdByUserId: staff.id });
		return { id: row.id };
	} catch (err) {
		mapDomainError(err);
	}
});

export const updateGrant = form(
	z.object({ id: z.string().min(1), ...grantFields }),
	async (data) => {
		await requireCapability('grant.manage');
		try {
			await grants.updateGrant(data.id, grantInput(data));
		} catch (err) {
			mapDomainError(err);
		}
		await getGrantDetail(data.id).refresh();
		return { success: true };
	}
);

export const deleteGrant = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('grant.manage');
	await grants.deleteGrant(data.id);
	return { success: true };
});

/** One click from the grant page: the next stage's tasks, which nothing applies unasked. */
export const applyGrantStage = form(
	z.object({ id: z.string().min(1), stage: z.enum(grantStages) }),
	async (data) => {
		const staff = await requireCapability('grant.manage');
		try {
			await grants.applyGrantStage(data.id, data.stage, staff.id);
		} catch (err) {
			mapDomainError(err);
		}
		await getGrantDetail(data.id).refresh();
		return { success: true };
	}
);
