import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveContactSheetToken } from '$lib/server/directory/contact-sheet-service';
import { detachSlot, listFor, replaceSlot } from '$lib/server/media/media-service';
import { uploadFile, resolveImageUrl } from '$lib/server/storage';
import { mediaKey } from '$lib/server/storage-keys';

/**
 * An external act's tech rider, as a file.
 *
 * `rider` is keyed on `group_id` and an external act has no group, so the ask
 * read as outstanding forever (#863). `media_attachment` is already
 * polymorphic with a `rider` slot. A route rather than a remote `form()`
 * because it carries a file; the token is the whole authorization, re-resolved.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

async function entryFor(token: string) {
	const link = await resolveContactSheetToken(token);
	if (!link) throw error(404, 'That link has expired or been withdrawn');
	return link.entryId;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const entryId = await entryFor(params.token);

	const formData = await request.formData();
	const file = formData.get('file');
	if (!(file instanceof File) || file.size === 0) throw error(400, 'No file provided');
	if (file.size > MAX_FILE_SIZE) throw error(400, 'That file is larger than 10MB');
	if (!ALLOWED.includes(file.type)) {
		throw error(400, 'A rider has to be a PDF, JPEG, PNG or WebP');
	}

	const key = mediaKey('acts/riders', entryId, file.type);
	await uploadFile(await file.arrayBuffer(), key, file.type, ALLOWED);

	// One rider, replaced rather than accumulated: an act that sends a new one
	// means the new one, and a stack of them is a question staff have to answer
	// on the night.
	await replaceSlot({
		attachableType: 'directory_entry',
		attachableId: entryId,
		slot: 'rider',
		key,
		contentType: file.type,
		byteSize: file.size,
		filename: file.name
	});

	return json({ url: resolveImageUrl(key), filename: file.name });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const entryId = await entryFor(params.token);
	// Detach only. The object and its `media` row are the sweep's to reap — this
	// module never deletes an R2 object as a side effect of a row going away.
	await detachSlot('directory_entry', entryId, 'rider');
	return json({ success: true });
};

export const GET: RequestHandler = async ({ params }) => {
	const entryId = await entryFor(params.token);
	const [rider] = await listFor('directory_entry', entryId, 'rider');
	return json(
		rider ? { url: resolveImageUrl(rider.key), filename: rider.filename } : { url: null }
	);
};
