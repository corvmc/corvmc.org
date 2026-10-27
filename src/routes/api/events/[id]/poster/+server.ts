import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireListingWriter } from '$lib/server/event/listing-guard';
import { uploadFile, validateUpload } from '$lib/server/storage';
import { detachSlot, replaceSlot } from '$lib/server/media/media-service';
import { mediaKey } from '$lib/server/storage-keys';
import { getById } from '$lib/server/event/event-service';
import { db } from '$lib/server/db';
import { eventListing } from '$lib/server/db/schema/event';
import { eq } from 'drizzle-orm';

/** Upload or replace an event poster image. A listing write, so the show's committee may too. */
export const POST: RequestHandler = async ({ params, request }) => {
	const user = await requireListingWriter(params.id);

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
		attachableType: 'event_listing',
		attachableId: params.id,
		slot: 'poster',
		key,
		contentType,
		byteSize: buffer.byteLength,
		filename: file.name,
		uploadedByUserId: user.id
	});

	await db
		.update(eventListing)
		.set({ updatedAt: new Date() })
		.where(eq(eventListing.id, params.id));

	return json({ posterKey: key });
};

/** Delete an event poster. */
export const DELETE: RequestHandler = async ({ params }) => {
	await requireListingWriter(params.id);

	const existing = await getById(params.id);
	if (!existing) throw error(404, 'Event not found');

	if (existing.posterKey) {
		await detachSlot('event_listing', params.id, 'poster');
		await db
			.update(eventListing)
			.set({ updatedAt: new Date() })
			.where(eq(eventListing.id, params.id));
	}

	return json({ success: true });
};
