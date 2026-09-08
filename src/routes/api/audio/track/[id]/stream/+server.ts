import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStreamableTrack } from '$lib/server/audio/audio-service';
import { streamAudioObject } from '$lib/server/audio/audio-storage';
import { requireFeature } from '$lib/server/feature-flags';
import { allowRateLimited } from '$lib/server/rate-limit';

/**
 * Play a track.
 *
 * Public and unauthenticated by design: full tracks stream for free, and what a
 * buyer pays for is the file — the download, in the format they chose, that they
 * keep. That is Bandcamp's bargain and it is the one that gets local music
 * heard. It is also what the radio needs, since a station cannot ask every
 * listener to log in.
 *
 * The paywall this endpoint *does* enforce is publication. A `draft` release has
 * never been shown to anybody and a `withheld` one has been taken down; both
 * answer 404 here, because a takedown that still serves bytes is not a takedown.
 *
 * The bytes come from the private bucket through this Worker rather than from a
 * public R2 domain. That costs a subrequest per listener and buys the only thing
 * that makes the private bucket worth having: there is no address for this
 * object that outlives this check.
 */
export const GET: RequestHandler = async ({ params, request, getClientAddress, setHeaders }) => {
	await requireFeature('bandAudio');

	const track = await getStreamableTrack(params.id);
	if (!track) throw error(404, 'Track not found');

	// Generous, because one listener seeking around a track is many requests:
	// each drag of the scrubber is a fresh ranged GET. This is here to stop a
	// script pulling the whole catalog in a loop, not to ration listening.
	const allowed = await allowRateLimited(`audio-stream:${getClientAddress()}`, 600, 300);
	if (!allowed) throw error(429, 'Too many requests — slow down and try again shortly.');

	const response = await streamAudioObject(track.objectKey, request.headers.get('range'));
	// The row survived its object. Not a 500: nothing is broken for the caller,
	// there is simply nothing to play.
	if (!response) throw error(404, 'Track not found');

	// Immutable in practice — a re-uploaded track gets a new key and therefore a
	// new URL, which is the whole point of the random token in `audioKey()`.
	// `private` because the object is not public: this permits the listener's own
	// browser to cache it and forbids any shared cache in between.
	setHeaders({ 'cache-control': 'private, max-age=86400' });

	return response;
};
