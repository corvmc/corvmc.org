import { z } from 'zod';
import { query } from '$app/server';
import { requireCapability } from '#lib/server/authorization.js';
import { renderMonthPoster } from '#lib/server/poster/calendar-service.js';
import { bytesDataUrl } from '#lib/server/poster/brand.js';

/** A month's calendar poster as a PNG data URL, for preview and download. */
export const getCalendarPoster = query(
	z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
	async (month) => {
		await requireCapability('marketing.read');
		return { month, png: bytesDataUrl(await renderMonthPoster(month), 'image/png') };
	}
);
