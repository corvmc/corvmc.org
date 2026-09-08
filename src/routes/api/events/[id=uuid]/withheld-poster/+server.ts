import { error } from '@sveltejs/kit';
// Typed params from `./$types` rather than the generic kit `RequestHandler`,
// which types `params.id` as possibly-undefined.
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/authorization';
import { getById } from '$lib/server/event/event-service';
import { getPrivateObject } from '$lib/server/private-storage';
import { isWithheldPosterKey } from '$lib/server/storage-keys';

/**
 * The one way a withheld poster reaches a person.
 *
 * A takedown moves the bytes to `R2_PRIVATE`, which has no custom domain and no
 * r2.dev URL, so nothing addresses them. That is the point — and it would also
 * make an appeal undecidable, because a reviewer cannot judge what they cannot
 * see. This handler is what lets both hold.
 */
// An API route rather than a remote function because it returns a stream, not
// JSON — the same reason `api/files/[id=uuid]` is one.
export const GET: RequestHandler = async ({ params }) => {
	// The row first, and the key comes from it. Nothing in the request names an
	// R2 key: a `?key=` would turn a moderation viewer into a read primitive over
	// the whole private bucket, which holds group documents and invoices.
	const row = await getById(params.id);

	// Before the guard, deliberately, and matching the files route. A listing
	// that was never taken down must be indistinguishable from one that does not
	// exist to a caller who has not been authorized for anything yet.
	if (!row || !isWithheldPosterKey(row.posterKey)) error(404, 'Not found');

	// `moderation.reviewFlags` — the capability the flag queue already guards
	// with, held by whoever handles the appeal this exists to serve. It takes no
	// resource, so it does not scope per listing: any holder can view any
	// withheld poster, which is the same reach they already have over the queue
	// those posters are attached to.
	await requireCapability('moderation.reviewFlags');

	const obj = await getPrivateObject(row.posterKey!);
	// A live row whose object is gone: a copy that failed after the re-point, or
	// the sweep mid-flight. An ordinary state, not a fault, so a 404 rather than
	// a 500 that reaches Sentry.
	if (!obj) error(404, 'Not found');

	return new Response(obj.body, {
		headers: {
			// From the key's extension, not from R2 and not from a column: the
			// takedown carries the original extension across, and `extensionForType`
			// derived it from a validated content type on the way in.
			'Content-Type': contentTypeForKey(row.posterKey!),
			'Content-Length': String(obj.size),
			// Without these two, Cloudflare's edge can cache one reviewer's
			// authorized response and serve it to the next requester — which would
			// put the bytes back in public circulation by another route.
			'Cache-Control': 'private, no-store',
			Vary: 'Cookie',
			// Belt and braces on a moderated upload: whatever the extension claims,
			// the browser must not sniff its way to rendering it as a document.
			'X-Content-Type-Options': 'nosniff'
		}
	});
};

/** The image types a poster can be, and a refusal to guess at anything else. */
function contentTypeForKey(key: string): string {
	const ext = key.split('.').pop()?.toLowerCase();
	const types: Record<string, string> = {
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		webp: 'image/webp',
		gif: 'image/gif'
	};
	return types[ext ?? ''] ?? 'application/octet-stream';
}
