import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { acquisition } from '$lib/server/db/schema/inventory';
import { eq } from 'drizzle-orm';
import { requireCapability } from '$lib/server/authorization';
import {
	deletePrivateObject,
	getPrivateObject,
	putPrivateObject,
	validatePrivateUpload
} from '$lib/server/private-storage';
import { contentDispositionAttachment, receiptKey } from '$lib/server/storage-keys';

/**
 * An acquisition's receipt, in the private bucket.
 *
 * A route rather than a remote form because an upload is multipart. Private
 * rather than `media_attachment`, which that table's `acquisition`/`receipt`
 * pair would suggest: everything there resolves through `getPublicUrl()`, and
 * a receipt carries card digits, a name and an address.
 */
async function loadRow(id: string) {
	const [row] = await db
		.select({ id: acquisition.id, receiptKey: acquisition.receiptKey })
		.from(acquisition)
		.where(eq(acquisition.id, id))
		.limit(1);
	if (!row) throw error(404, 'Acquisition not found');
	return row;
}

export const POST: RequestHandler = async ({ params, request }) => {
	await requireCapability('inventory.manageAcquisitions');
	const row = await loadRow(params.id);

	const form = await request.formData();
	const file = form.get('receipt');
	if (!(file instanceof File) || file.size === 0) throw error(400, 'No file provided');

	// Validated before anything is written, so a bad upload cannot strand the
	// receipt already there.
	const reason = validatePrivateUpload(file);
	if (reason) throw error(400, reason);

	const key = receiptKey(row.id, file.type);
	await putPrivateObject(key, await file.arrayBuffer(), file.type);

	// The old object goes only once the new key is recorded: an orphan is
	// reclaimable, a row pointing at nothing is not.
	await db
		.update(acquisition)
		.set({ receiptKey: key, updatedAt: new Date() })
		.where(eq(acquisition.id, row.id));
	if (row.receiptKey && row.receiptKey !== key) await deletePrivateObject(row.receiptKey);

	return json({ key });
};

export const GET: RequestHandler = async ({ params }) => {
	await requireCapability('inventory.read');
	const row = await loadRow(params.id);
	if (!row.receiptKey) throw error(404, 'No receipt');

	const obj = await getPrivateObject(row.receiptKey);
	if (!obj) throw error(404, 'No receipt');

	return new Response(obj.body, {
		headers: {
			'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
			'Content-Disposition': contentDispositionAttachment(`receipt-${row.id}`),
			'Cache-Control': 'private, no-store'
		}
	});
};

export const DELETE: RequestHandler = async ({ params }) => {
	await requireCapability('inventory.manageAcquisitions');
	const row = await loadRow(params.id);

	await db
		.update(acquisition)
		.set({ receiptKey: null, updatedAt: new Date() })
		.where(eq(acquisition.id, row.id));
	if (row.receiptKey) await deletePrivateObject(row.receiptKey);

	return json({ success: true });
};
