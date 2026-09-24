import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import * as service from '$lib/server/sponsor/sponsor-service';
import { clubToday, LONG_TEXT_MAX, SHORT_TEXT_MAX, sponsorshipStatuses } from '$lib/config';

/** An `<input type="date">` value, or blank for "no date". */
const isoDay = z
	.string()
	.regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Pick a date')
	.optional();
const optionalText = (max: number) => z.string().max(max).optional();

const sponsorFields = {
	name: z.string().trim().min(1, 'Name the business').max(SHORT_TEXT_MAX),
	website: optionalText(SHORT_TEXT_MAX),
	contactName: optionalText(SHORT_TEXT_MAX),
	contactEmail: optionalText(SHORT_TEXT_MAX),
	notes: optionalText(LONG_TEXT_MAX)
};

function sponsorInput(d: z.infer<z.ZodObject<typeof sponsorFields>>) {
	return {
		name: d.name,
		website: d.website || null,
		contactName: d.contactName || null,
		contactEmail: d.contactEmail || null,
		notes: d.notes || null
	};
}

const sponsorshipFields = {
	title: z.string().trim().min(1, 'Give it a name').max(SHORT_TEXT_MAX),
	status: z.enum(sponsorshipStatuses),
	tier: optionalText(SHORT_TEXT_MAX),
	// A cleared money field is dropped from the payload, not sent as null.
	amountCents: z.number().int().min(0).optional(),
	startsOn: isoDay,
	endsOn: isoDay,
	notes: optionalText(LONG_TEXT_MAX)
};

function sponsorshipInput(d: z.infer<z.ZodObject<typeof sponsorshipFields>>) {
	return {
		title: d.title,
		status: d.status,
		tier: d.tier || null,
		amountCents: d.amountCents ?? null,
		startsOn: d.startsOn || null,
		endsOn: d.endsOn || null,
		notes: d.notes || null
	};
}

export const getSponsors = query(async () => {
	await requireCapability('sponsor.read');
	return service.listSponsors(clubToday());
});

export const getSponsorDetail = query(z.string(), async (id) => {
	await requireCapability('sponsor.read');
	try {
		return await service.getSponsor(id, clubToday());
	} catch (err) {
		mapDomainError(err);
	}
});

export const createSponsor = form(z.object(sponsorFields), async (data) => {
	await requireCapability('sponsor.manage');
	const row = await service.createSponsor(sponsorInput(data));
	return { id: row.id };
});

export const updateSponsor = form(
	z.object({ id: z.string().min(1), ...sponsorFields }),
	async (data) => {
		await requireCapability('sponsor.manage');
		await service.updateSponsor(data.id, sponsorInput(data));
		await getSponsorDetail(data.id).refresh();
		return { success: true };
	}
);

export const deleteSponsor = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('sponsor.manage');
	await service.deleteSponsor(data.id);
	return { success: true };
});

export const createSponsorship = form(
	z.object({ sponsorId: z.string().min(1), ...sponsorshipFields }),
	async (data) => {
		await requireCapability('sponsor.manage');
		await service.createSponsorship({ sponsorId: data.sponsorId, ...sponsorshipInput(data) });
		await getSponsorDetail(data.sponsorId).refresh();
		return { success: true };
	}
);

export const updateSponsorship = form(
	z.object({ id: z.string().min(1), sponsorId: z.string().min(1), ...sponsorshipFields }),
	async (data) => {
		await requireCapability('sponsor.manage');
		await service.updateSponsorship(data.id, sponsorshipInput(data));
		await getSponsorDetail(data.sponsorId).refresh();
		return { success: true };
	}
);

export const deleteSponsorship = form(
	z.object({ id: z.string().min(1), sponsorId: z.string().min(1) }),
	async (data) => {
		await requireCapability('sponsor.manage');
		await service.deleteSponsorship(data.id);
		await getSponsorDetail(data.sponsorId).refresh();
		return { success: true };
	}
);
