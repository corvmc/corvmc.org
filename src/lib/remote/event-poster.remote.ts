import { z } from 'zod';
import { command } from './_remote';
import { requireListingWriter } from '#lib/server/event/listing-guard.js';
import { renderEventPoster } from '#lib/server/poster/event-letter-service.js';
import { bytesDataUrl } from '#lib/server/poster/brand.js';

/**
 * The event's Letter print poster, as a PDF data URL to download. A listing
 * write, as the template flyer is: the same people may make the event's posters.
 */
export const printEventPoster = command(
	z.object({ eventId: z.string().min(1) }),
	async ({ eventId }) => {
		await requireListingWriter(eventId);
		const { pdf, title } = await renderEventPoster(eventId);
		const slug =
			title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '') || 'event';
		return {
			file: bytesDataUrl(pdf, 'application/pdf'),
			filename: `${slug}-poster-letter.pdf`
		};
	}
);
