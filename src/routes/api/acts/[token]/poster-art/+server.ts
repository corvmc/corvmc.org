import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveContactSheetToken } from '$lib/server/directory/contact-sheet-service';
import {
	deliverPosterArt,
	PosterRequestNotFoundError
} from '$lib/server/production/artifact-request-service';

/**
 * An artist's poster art, against one of their own asks. A route rather than a
 * remote `form()` because it carries a file. The token names the entry; the
 * body only says which of that entry's asks this answers, and the service
 * refuses one that is not theirs.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png'];

export const POST: RequestHandler = async ({ params, request }) => {
	const link = await resolveContactSheetToken(params.token);
	if (!link) throw error(404, 'That link has expired or been withdrawn');

	const formData = await request.formData();
	const requestId = formData.get('requestId');
	const file = formData.get('file');
	if (typeof requestId !== 'string' || !requestId) throw error(400, 'Which show is this for?');
	if (!(file instanceof File) || file.size === 0) throw error(400, 'No file provided');
	if (file.size > MAX_FILE_SIZE) throw error(400, 'That file is larger than 10MB');
	if (!ALLOWED.includes(file.type)) throw error(400, 'Poster art has to be a JPEG or PNG');

	try {
		await deliverPosterArt({
			entryId: link.entryId,
			requestId,
			file: { buffer: await file.arrayBuffer(), contentType: file.type, filename: file.name }
		});
	} catch (err) {
		if (err instanceof PosterRequestNotFoundError) throw error(404, err.message);
		throw err;
	}
	return json({ success: true });
};
