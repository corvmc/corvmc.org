import { z } from 'zod';
import { query } from '$app/server';
import { posterFormats } from '#lib/config.js';
import { requireCapability } from '#lib/server/authorization.js';
import { renderMonthPoster } from '#lib/server/poster/calendar-service.js';
import { bytesDataUrl } from '#lib/server/poster/brand.js';

/**
 * A month's calendar poster in one format, as data URLs: the file to download
 * (a PDF for print, a PNG for social) and a PNG preview of the same page.
 */
export const getCalendarPoster = query(
	z.object({
		month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
		format: z.enum(posterFormats)
	}),
	async ({ month, format }) => {
		await requireCapability('marketing.read');
		const out = await renderMonthPoster(month, format);
		return {
			month,
			format,
			file: bytesDataUrl(out.file, out.contentType),
			extension: out.contentType === 'application/pdf' ? 'pdf' : 'png',
			preview: bytesDataUrl(out.preview, 'image/png')
		};
	}
);
