import { error } from '@sveltejs/kit';
// Typed params from `./$types` rather than the generic kit `RequestHandler`,
// which types `params.id` as possibly-undefined.
import type { RequestHandler } from './$types';
import { requireGroupRole } from '$lib/server/group/group-context';
import { getForDownload } from '$lib/server/group/file-service';
import { getPrivateObject } from '$lib/server/private-storage';
import { contentDispositionAttachment } from '$lib/server/storage-keys';

/**
 * The one way a private object reaches a person.
 *
 * Unlike avatars and posters, which sit on a separate media origin and are
 * public by construction, a group document is served **from the app origin with
 * session cookies attached**. Everything unusual about this handler follows from
 * that.
 *
 * An API route rather than a remote function because it returns a stream, not
 * JSON — which is also why the upload and the delete are *not* here. Those are
 * remote forms in `$lib/remote/files.remote.ts`; the spec's routes table listed
 * a `DELETE` verb only because this `GET` was already in it.
 */
export const GET: RequestHandler = async ({ params }) => {
	// Read the row first. The group this authorizes against comes from stored
	// state and never from the request — there is no `?groupId=` to disagree
	// with, and no route param naming a group to be swapped.
	const row = await getForDownload(params.id);

	// Before the guard, deliberately. A removed document must be
	// indistinguishable from one that never existed to a caller who has not been
	// authorized for anything yet — running the guard first would let an outsider
	// tell "no such file" from "not your file" by the status code.
	if (!row) error(404, 'Not found');

	// The whole authorization, against the file's own group. `allowStaff`,
	// matching every other group read.
	await requireGroupRole({ id: row.groupId }, 'member', { allowStaff: true });

	const obj = await getPrivateObject(row.key);
	// A live row whose object is gone: a put that failed after the insert, or the
	// sweep mid-flight. An ordinary state, not a fault, so it is a 404 rather
	// than a 500 that reaches Sentry.
	if (!obj) error(404, 'Not found');

	return new Response(obj.body, {
		headers: {
			// The row is the authority, not `obj.writeHttpMetadata` — R2 stores what
			// it was handed, and the row is what the type check ran against.
			'Content-Type': row.contentType,
			'Content-Length': String(obj.size),
			'Content-Disposition': contentDispositionAttachment(row.filename),
			// Without these two, Cloudflare's edge can cache one member's authorized
			// response and serve it to the next requester — which would make the
			// whole feature a public bucket with extra steps. No `ETag`: `no-store`
			// makes one meaningless.
			'Cache-Control': 'private, no-store',
			Vary: 'Cookie',
			// Serving a user-uploaded `text/html` inline would be stored XSS against
			// corvmc.org. The forced attachment above is the first half; this is the
			// half that survives a browser deciding it knows better.
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
