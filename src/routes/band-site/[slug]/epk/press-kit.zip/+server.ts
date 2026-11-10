/**
 * The public press kit as a zip: the `/epk` page's one-pager, a plain-text
 * version and the gallery photos at full resolution.
 *
 * Unauthenticated, so it answers 404 for any band whose `/epk` page would, and
 * `loadPublicPressKit` decides that rather than the page that links here. Its
 * content is the public projection only — no contacts. The band's own download,
 * with contacts, is `/api/bands/[id]/press-kit.zip`.
 */
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { allowRateLimited } from '#lib/server/rate-limit.js';
import {
	loadPublicPressKit,
	packPressKit,
	pressKitFilename
} from '#lib/server/band/press-kit-zip.js';

export const GET: RequestHandler = async ({ params, getClientAddress }) => {
	const kit = await loadPublicPressKit(params.slug);
	if (!kit) throw error(404, 'Page not found');

	// Each download pulls every photo out of R2 into one isolate. This stops a
	// script fetching it in a loop, not a venue saving it twice.
	const allowed = await allowRateLimited(`press-kit-zip:${getClientAddress()}`, 20, 3600);
	if (!allowed) throw error(429, 'Too many downloads. Try again in an hour.');

	const zipped = await packPressKit(kit.content, kit.photoKeys);

	return new Response(zipped, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${pressKitFilename(kit.name)}"`,
			'content-length': String(zipped.byteLength),
			'cache-control': 'public, max-age=300'
		}
	});
};
