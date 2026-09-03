import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	trackForToken,
	recordDownload,
	findPaidPurchaseByToken
} from '$lib/server/audio/purchase-service';
import { streamAudioObject } from '$lib/server/audio/audio-storage';
import { requireFeature } from '$lib/server/feature-flags';

/**
 * The file itself — the thing that was actually bought.
 *
 * Distinct from `/api/audio/track/[id]/stream` in the two ways that matter:
 * this one requires a paid purchase, and it sets `Content-Disposition:
 * attachment` with the band's own filename so what lands in the buyer's
 * downloads folder is named the way they expect rather than after a UUID.
 *
 * Ranges are honoured here too. A 200MB album over a phone connection gets
 * resumed by every download manager there is, and refusing a range turns a
 * dropped connection into starting over.
 */
export const GET: RequestHandler = async ({ params, request, setHeaders }) => {
	await requireFeature('bandAudio');

	// Scoped by the token's own release: a track id from a release this purchase
	// does not cover is a 404, not a 403.
	const track = await trackForToken(params.token, params.trackId);
	if (!track) throw error(404, 'Not found');

	const response = await streamAudioObject(track.objectKey, request.headers.get('range'));
	if (!response) throw error(404, 'Not found');

	const filename = (track.originalFilename ?? `${track.title}.bin`).replace(/["\\]/g, '');
	const headers = new Headers(response.headers);
	// RFC 5987 alongside the plain form: the plain one is ASCII-only and plenty
	// of records have an accent or an em dash in a title.
	headers.set(
		'content-disposition',
		`attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`
	);
	// Never cached by anything shared: this response is one buyer's entitlement.
	setHeaders({ 'cache-control': 'private, no-store' });

	// Counted once per file, and only on a fresh request — a resumed range would
	// otherwise inflate this into meaninglessness.
	if (!request.headers.get('range')) {
		const purchase = await findPaidPurchaseByToken(params.token);
		if (purchase) await recordDownload(purchase.purchase.id);
	}

	return new Response(response.body, { status: response.status, headers });
};
