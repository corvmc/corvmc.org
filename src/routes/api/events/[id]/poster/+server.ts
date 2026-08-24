import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hasAnyRole } from '$lib/server/authorization';
import { uploadFile, deleteObject, validateUpload } from '$lib/server/storage';
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

	// Delete old poster if replacing
	if (existing.posterKey) {
		await deleteObject(existing.posterKey);
	}

	const key = mediaKey('events/posters', params.id, contentType);

	await uploadFile(buffer, key, contentType);

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
		await deleteObject(existing.posterKey);
		await db
			.update(event)
			.set({ posterKey: null, updatedAt: new Date() })
			.where(eq(event.id, params.id));
	}

	return json({ success: true });
};
