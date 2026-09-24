import { error, type RequestHandler } from '@sveltejs/kit';
import { requireCapability } from '$lib/server/authorization';
import { getRenewalDocument } from '$lib/server/renewal/renewal-service';
import { getPrivateObject } from '$lib/server/private-storage';
import { contentDispositionAttachment } from '$lib/server/storage-keys';

/**
 * Read a renewal's certificate back out of the private bucket. Keyed on the
 * attachment, so the object key never reaches the browser and a link cannot
 * outlive the permission behind it.
 */
export const GET: RequestHandler = async ({ params }) => {
	await requireCapability('renewal.read');

	const doc = await getRenewalDocument(params.id ?? '');
	if (!doc) error(404, 'Not found');

	const obj = await getPrivateObject(doc.key);
	if (!obj) error(404, 'Not found');

	return new Response(obj.body, {
		headers: {
			'Content-Type': doc.contentType ?? 'application/octet-stream',
			'Content-Disposition': contentDispositionAttachment(doc.filename ?? 'document'),
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, no-store'
		}
	});
};
