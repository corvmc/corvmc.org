import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import {
	listAgreements,
	getAgreement,
	createAgreement as createService,
	updateAgreement as updateService,
	deleteAgreement as deleteService,
	nextDeadline
} from '$lib/server/agreement/agreement-service';
import {
	agreementKinds,
	agreementStatuses,
	clubToday,
	LONG_TEXT_MAX,
	SHORT_TEXT_MAX
} from '$lib/config';

/** An `<input type="date">` value, or blank for "no date". */
const isoDay = z
	.string()
	.regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Pick a date')
	.optional();

const agreementFields = {
	kind: z.enum(agreementKinds),
	counterparty: z.string().trim().min(1, 'Who is this with?').max(SHORT_TEXT_MAX),
	title: z.string().trim().min(1, 'Give it a name').max(SHORT_TEXT_MAX),
	status: z.enum(agreementStatuses),
	// A cleared money field is dropped from the payload, not sent as null.
	amountCents: z.number().int().min(0).optional(),
	tier: z.string().max(SHORT_TEXT_MAX).optional(),
	contactName: z.string().max(SHORT_TEXT_MAX).optional(),
	contactEmail: z.string().max(SHORT_TEXT_MAX).optional(),
	applyBy: isoDay,
	startsOn: isoDay,
	endsOn: isoDay,
	reportDueOn: isoDay,
	notes: z.string().max(LONG_TEXT_MAX).optional()
};

type Fields = z.infer<z.ZodObject<typeof agreementFields>>;

function agreementInput(data: Fields) {
	return {
		kind: data.kind,
		counterparty: data.counterparty,
		title: data.title,
		status: data.status,
		amountCents: data.amountCents ?? null,
		tier: data.tier || null,
		contactName: data.contactName || null,
		contactEmail: data.contactEmail || null,
		applyBy: data.applyBy || null,
		startsOn: data.startsOn || null,
		endsOn: data.endsOn || null,
		reportDueOn: data.reportDueOn || null,
		notes: data.notes || null
	};
}

export const getAgreements = query(
	z.object({ includeClosed: z.boolean().optional() }),
	async ({ includeClosed }) => {
		await requireCapability('agreement.read');
		return listAgreements({ today: clubToday(), includeClosed });
	}
);

export const getAgreementDetail = query(z.string(), async (id) => {
	await requireCapability('agreement.read');
	try {
		const row = await getAgreement(id);
		return { ...row, deadline: nextDeadline(row, clubToday()) };
	} catch (err) {
		mapDomainError(err);
	}
});

export const createAgreement = form(z.object(agreementFields), async (data) => {
	await requireCapability('agreement.manage');
	const row = await createService(agreementInput(data));
	return { id: row.id };
});

export const updateAgreement = form(
	z.object({ id: z.string().min(1), ...agreementFields }),
	async (data) => {
		await requireCapability('agreement.manage');
		await updateService(data.id, agreementInput(data));
		await getAgreementDetail(data.id).refresh();
		return { success: true };
	}
);

export const deleteAgreement = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('agreement.manage');
	await deleteService(data.id);
	return { success: true };
});
