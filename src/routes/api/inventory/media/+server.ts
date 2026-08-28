import { json, error, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { uploadFile } from '$lib/server/storage';
import { mediaKey } from '$lib/server/storage-keys';
import { attach, record } from '$lib/server/media/media-service';
import { isStaff } from '$lib/server/authorization';
import type { MediaSlot } from '$lib/server/db/schema/media';

/**
 * Uploading a file for an inventory item, unit, or acquisition.
 *
 * An API route rather than a remote function because a remote `form()` carries
 * fields, not a multipart body — the same reason `/api/bands/[id]/media` exists.
 * Everything after the upload goes through the shared media layer, so the R2
 * object's lifetime is decided by how many attachments point at it and by
 * nothing else.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** A manual is usually a PDF; damage evidence is a photo from a phone. */
const MANUAL_TYPES = [...IMAGE_TYPES, 'application/pdf'];

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const form = await request.formData();
	const file = form.get('file');
	const slot = String(form.get('slot') ?? '') as MediaSlot;
	const attachableId = String(form.get('attachableId') ?? '');

	if (!(file instanceof File)) error(400, 'No file');
	if (!attachableId) error(400, 'No target');

	// The slot decides both who may write and what may be written. A manual is
	// documentation staff publish; damage evidence is something any member can
	// add, because the person who finds a broken amp is rarely a staffer.
	let attachableType: 'inventory_item' | 'inventory_asset' | 'acquisition';
	let allowed: string[];

	if (slot === 'manual') {
		if (!(await isStaff(locals.user.id))) error(403, 'Staff only');
		attachableType = 'inventory_item';
		allowed = MANUAL_TYPES;
	} else if (slot === 'damage') {
		attachableType = 'inventory_asset';
		allowed = IMAGE_TYPES;
	} else if (slot === 'receipt') {
		// What was paid, against the row that records it. Staff-only because an
		// acquisition is an accounting record, not something a member touches —
		// and usually a phone photo of a till receipt rather than a PDF.
		if (!(await isStaff(locals.user.id))) error(403, 'Staff only');
		attachableType = 'acquisition';
		allowed = MANUAL_TYPES;
	} else {
		error(400, 'Unsupported slot');
	}

	if (file.size > MAX_BYTES) error(413, 'File is larger than 10MB');

	const buffer = await file.arrayBuffer();
	const key = mediaKey(`inventory/${slot}`, randomUUID(), file.type);

	try {
		await uploadFile(buffer, key, file.type, allowed);
	} catch (err) {
		error(400, (err as Error).message);
	}

	const row = await record({
		key,
		contentType: file.type,
		byteSize: file.size,
		filename: file.name,
		uploadedByUserId: locals.user.id
	});

	await attach({ mediaId: row.id, attachableType, attachableId, slot });

	return json({ id: row.id, key });
};
