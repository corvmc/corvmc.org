import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import * as grants from '$lib/server/grant/grant-service';
import * as funders from '$lib/server/grant/funder-service';
import { clubToday, grantStatuses, LONG_TEXT_MAX, SHORT_TEXT_MAX } from '$lib/config';

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
		contactName: d.contactName || null,
		contactEmail: d.contactEmail || null,
		notes: d.notes || null
	};
}

export const getFunders = query(
	z.object({ includeArchived: z.boolean().optional() }).optional(),
	async (filters) => {
		await requireCapability('grant.read');
		return funders.listFunders({ includeArchived: filters?.includeArchived ?? false });
	}
);

export const createFunder = form(z.object(funderFields), async (data) => {
	await requireCapability('grant.manage');
	const row = await funders.createFunder(funderInput(data));
	return { id: row.id };
});

export const updateFunder = form(
	z.object({ id: z.string().min(1), ...funderFields }),
	async (data) => {
		await requireCapability('grant.manage');
		await funders.updateFunder(data.id, funderInput(data));
		return { success: true };
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
	notes: optionalText(LONG_TEXT_MAX)
};

function grantInput(d: z.infer<z.ZodObject<typeof grantFields>>) {
	return {
		funderId: d.funderId,
		title: d.title,
		status: d.status,
		amountRequestedCents: d.amountRequestedCents ?? null,
		amountAwardedCents: d.amountAwardedCents ?? null,
		applyBy: d.applyBy || null,
		startsOn: d.startsOn || null,
		endsOn: d.endsOn || null,
		notes: d.notes || null
	};
}

export const getGrants = query(
	z.object({ includeClosed: z.boolean().optional() }),
	async ({ includeClosed }) => {
		await requireCapability('grant.read');
		// The funders ride along for the create form: one load-bearing query per page.
		const [rows, funderRows] = await Promise.all([
			grants.listGrants({ today: clubToday(), includeClosed }),
			funders.listFunders()
		]);
		return { grants: rows, funders: funderRows.map((f) => ({ id: f.id, name: f.name })) };
	}
);

export const getGrantDetail = query(z.string(), async (id) => {
	await requireCapability('grant.read');
	try {
		const [grant, funderRows] = await Promise.all([
			grants.getGrant(id, clubToday()),
			funders.listFunders({ includeArchived: true })
		]);
		// An archived funder stays pickable on the application that already names it.
		const pickable = funderRows.filter((f) => !f.deletedAt || f.id === grant.funderId);
		return { ...grant, funders: pickable.map((f) => ({ id: f.id, name: f.name })) };
	} catch (err) {
		mapDomainError(err);
	}
});

export const createGrant = form(z.object(grantFields), async (data) => {
	await requireCapability('grant.manage');
	const row = await grants.createGrant(grantInput(data));
	return { id: row.id };
});

export const updateGrant = form(
	z.object({ id: z.string().min(1), ...grantFields }),
	async (data) => {
		await requireCapability('grant.manage');
		await grants.updateGrant(data.id, grantInput(data));
		await getGrantDetail(data.id).refresh();
		return { success: true };
	}
);

export const deleteGrant = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('grant.manage');
	await grants.deleteGrant(data.id);
	return { success: true };
});

// ------------------------------------------------------------------ reports

const reportFields = {
	grantApplicationId: z.string().min(1),
	title: z.string().trim().min(1, 'Name the report').max(SHORT_TEXT_MAX),
	dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the due date'),
	submittedOn: isoDay,
	notes: optionalText(LONG_TEXT_MAX)
};

function reportInput(d: z.infer<z.ZodObject<typeof reportFields>>) {
	return {
		title: d.title,
		dueOn: d.dueOn,
		submittedOn: d.submittedOn || null,
		notes: d.notes || null
	};
}

export const addGrantReport = form(z.object(reportFields), async (data) => {
	await requireCapability('grant.manage');
	await grants.addGrantReport({
		grantApplicationId: data.grantApplicationId,
		...reportInput(data)
	});
	await getGrantDetail(data.grantApplicationId).refresh();
	return { success: true };
});

export const updateGrantReport = form(
	z.object({ id: z.string().min(1), ...reportFields }),
	async (data) => {
		await requireCapability('grant.manage');
		await grants.updateGrantReport(data.id, reportInput(data));
		await getGrantDetail(data.grantApplicationId).refresh();
		return { success: true };
	}
);

export const deleteGrantReport = form(
	z.object({ id: z.string().min(1), grantApplicationId: z.string().min(1) }),
	async (data) => {
		await requireCapability('grant.manage');
		await grants.deleteGrantReport(data.id);
		await getGrantDetail(data.grantApplicationId).refresh();
		return { success: true };
	}
);
