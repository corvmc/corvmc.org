import { error, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { media, mediaAttachment } from '$lib/server/db/schema/media';
import { eq } from 'drizzle-orm';
import { requireCapability } from '$lib/server/authorization';
import { getPrivateObject } from '$lib/server/private-storage';
import { contentDispositionAttachment, isReceiptKey } from '$lib/server/storage-keys';

/**
 * Read a receipt back out of the private bucket.
 *
 * Keyed on the attachment, not the object: the key never reaches the browser,
 * so a link cannot outlive the permission behind it. Everything else in
 * `media_attachment` is served straight off media.corvmc.org, which is why
 * this route exists only for the one slot that must not be.
 */
export const GET: RequestHandler = async ({ params }) => {
	await requireCapability('inventory.read');

	const attachmentId = params.id;
	if (!attachmentId) error(404, 'Not found');

	const [link] = await db
		.select({ mediaId: mediaAttachment.mediaId, slot: mediaAttachment.slot })
		.from(mediaAttachment)
		.where(eq(mediaAttachment.id, attachmentId))
		.limit(1);

	if (!link || link.slot !== 'receipt') error(404, 'Not found');

	const [row] = await db
		.select({ key: media.key, contentType: media.contentType, filename: media.filename })
		.from(media)
		.where(eq(media.id, link.mediaId))
		.limit(1);

	if (!row) error(404, 'Not found');

	// A receipt attached before this route existed is still on the public
	// bucket. Refusing is the honest answer — serving it from here would imply
	// a privacy it does not have. `scripts/db/backfill` moves them.
	if (!isReceiptKey(row.key))
		error(409, 'This receipt predates private storage and needs migrating');

	const obj = await getPrivateObject(row.key);
	if (!obj) error(404, 'Not found');

	return new Response(obj.body, {
		headers: {
			'Content-Type': row.contentType ?? 'application/octet-stream',
			'Content-Disposition': contentDispositionAttachment(row.filename ?? 'receipt'),
			'Cache-Control': 'private, no-store'
		}
	});
};
