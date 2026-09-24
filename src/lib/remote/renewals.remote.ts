import { z } from 'zod';
import { query } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { form } from './_remote';
import { listUsersWithCapability, requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import * as service from '$lib/server/renewal/renewal-service';
import { clubToday, LONG_TEXT_MAX, SHORT_TEXT_MAX, renewalKinds } from '$lib/config';

const optionalText = (max: number) => z.string().max(max).optional();

const renewalFields = {
	name: z.string().trim().min(1, 'Name it').max(SHORT_TEXT_MAX),
	kind: z.enum(renewalKinds),
	issuer: optionalText(SHORT_TEXT_MAX),
	reference: optionalText(SHORT_TEXT_MAX),
	expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the expiry date'),
	responsibleUserId: optionalText(SHORT_TEXT_MAX),
	notes: optionalText(LONG_TEXT_MAX)
};

function renewalInput(d: z.infer<z.ZodObject<typeof renewalFields>>) {
	return {
		name: d.name,
		kind: d.kind,
		issuer: d.issuer || null,
		reference: d.reference || null,
		expiresOn: d.expiresOn,
		responsibleUserId: d.responsibleUserId || null,
		notes: d.notes || null
	};
}

/** Who may be made responsible: whoever manages renewals. Names only. */
async function assigneeOptions() {
	const managers = await listUsersWithCapability('renewal.manage');
	return managers.map((u) => ({ id: u.id, name: u.name }));
}

/** Every renewal, soonest expiry first, and who may be made responsible for one. */
export const getRenewals = query(async () => {
	await requireCapability('renewal.read');
	const [renewals, assignees] = await Promise.all([
		service.listRenewals(clubToday()),
		assigneeOptions()
	]);
	return { renewals, assignees };
});

/** One renewal, and the same assignee list, so the edit form needs no second query. */
export const getRenewalDetail = query(z.string(), async (id) => {
	await requireCapability('renewal.read');
	try {
		const [renewal, assignees] = await Promise.all([
			service.getRenewal(id, clubToday()),
			assigneeOptions()
		]);
		return { ...renewal, assignees };
	} catch (err) {
		mapDomainError(err);
	}
});

export const createRenewal = form(z.object(renewalFields), async (data) => {
	await requireCapability('renewal.manage');
	const row = await service.createRenewal(renewalInput(data));
	return { id: row.id };
});

export const updateRenewal = form(
	z.object({ id: z.string().min(1), ...renewalFields }),
	async (data) => {
		await requireCapability('renewal.manage');
		try {
			await service.updateRenewal(data.id, renewalInput(data));
		} catch (err) {
			mapDomainError(err);
		}
		await getRenewalDetail(data.id).refresh();
		return { success: true };
	}
);

export const deleteRenewal = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('renewal.manage');
	try {
		await service.deleteRenewal(data.id);
	} catch (err) {
		mapDomainError(err);
	}
	return { success: true };
});

export const removeRenewalDocument = form(
	z.object({ id: z.string().min(1), attachmentId: z.string().min(1) }),
	async (data) => {
		await requireCapability('renewal.manage');
		try {
			await service.removeRenewalDocument(data.id, data.attachmentId);
		} catch (err) {
			mapDomainError(err);
		}
		await getRenewalDetail(data.id).refresh();
		return { success: true };
	}
);

export const uploadRenewalDocument = form(
	z.object({ id: z.string().min(1), file: z.instanceof(File) }),
	async (data, issue) => {
		const staff = await requireCapability('renewal.manage');
		// An empty file input still posts a zero-byte `File`.
		if (!data.file || data.file.size === 0) invalid(issue.file('Choose a file to upload.'));
		try {
			await service.uploadRenewalDocument({
				renewalId: data.id,
				file: data.file,
				uploadedByUserId: staff.id
			});
		} catch (err) {
			mapDomainError(err);
		}
		await getRenewalDetail(data.id).refresh();
		return { success: true };
	}
);
