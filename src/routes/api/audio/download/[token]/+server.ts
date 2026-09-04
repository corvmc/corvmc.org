import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findPaidPurchaseByToken } from '$lib/server/audio/purchase-service';
import { listTracks } from '$lib/server/audio/audio-service';
import { requireFeature } from '$lib/server/feature-flags';

/**
 * What a download token entitles its holder to.
 *
 * A listing rather than a file, because a release is several files and a single
 * "download" that guessed which one would be wrong most of the time. The page
 * this feeds offers each track by name.
 *
 * The token IS the entitlement — there is no session check — because a buyer
 * with no account has nothing else. It is a full random UUID with the dashes
 * stripped and it is never listed anywhere, so guessing one is the only attack
 * and it is not a feasible one.
 */
export const GET: RequestHandler = async ({ params }) => {
	await requireFeature('bandAudio');

	const purchase = await findPaidPurchaseByToken(params.token);
	// A pending purchase answers exactly like a nonexistent one: whether a token
	// is real but unpaid is not something an unauthenticated caller should learn.
	if (!purchase) throw error(404, 'Not found');

	const tracks = await listTracks(purchase.releaseId);

	return json({
		releaseTitle: purchase.releaseTitle,
		bandName: purchase.bandName,
		tracks: tracks.map((t) => ({
			id: t.id,
			title: t.title,
			trackNumber: t.trackNumber,
			durationMs: t.durationMs,
			href: `/api/audio/download/${params.token}/${t.id}` // absolute path: this is JSON for a client that is not the app
		}))
	});
};
