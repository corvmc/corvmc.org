import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hasAnyRole } from '$lib/server/authorization';
import { uploadFile, validateUpload } from '$lib/server/storage';
import { detachSlot, replaceSlot } from '$lib/server/media/media-service';
import { mediaKey } from '$lib/server/storage-keys';
import { getById } from '$lib/server/event/event-service';
import { db } from '$lib/server/db';
import { event } from '$lib/server/db/schema/event';
import { eq } from 'drizzle-orm';

/** Upload or replace an event poster image. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	const allowed = await hasAnyRole(locals.user.id, ['admin', 'staff']);
	if (!allowed) throw error(403, 'Staff access required');

	const existing = await getById(params.id);
	if (!existing) throw error(404, 'Event not found');
	if (existing.status === 'cancelled') throw error(400, 'Cannot update a cancelled event');

	const formData = await request.formData();
	const file = formData.get('poster');
	if (!(file instanceof File)) throw error(400, 'No file provided');

	// Validate before mutating anything so a bad upload doesn't wipe the existing poster.
	const reason = validateUpload(file);
	if (reason) throw error(400, reason);

	const buffer = await file.arrayBuffer();
	const contentType = file.type;

	const key = mediaKey('events/posters', params.id, contentType);

	await uploadFile(buffer, key, contentType);

	// The previous poster is released, never deleted — a recurring series'
	// occurrences share one object. See docs/specs/shipped/media-spec.md.
	await replaceSlot({
		attachableType: 'event',
		attachableId: params.id,
		slot: 'poster',
		key,
		contentType,
		byteSize: buffer.byteLength,
		filename: file.name,
		uploadedByUserId: locals.user.id
	});

	await db
		.update(event)
		.set({ posterKey: key, updatedAt: new Date() })
		.where(eq(event.id, params.id));

	return json({ posterKey: key });
};

/** Delete an event poster. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	const allowed = await hasAnyRole(locals.user.id, ['admin', 'staff']);
	if (!allowed) throw error(403, 'Staff access required');

	const existing = await getById(params.id);
	if (!existing) throw error(404, 'Event not found');

	if (existing.posterKey) {
		await detachSlot('event', params.id, 'poster');
		await db
			.update(event)
			.set({ posterKey: null, updatedAt: new Date() })
			.where(eq(event.id, params.id));
	}

	return json({ success: true });
};
