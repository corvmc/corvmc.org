import { z } from 'zod';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import {
	addEventPhotos,
	describeEventPhoto as describePhoto,
	removeEventPhoto as removePhoto
} from '$lib/server/event/event-photo-service';
import { getStaffEventPage } from '$lib/remote/events.remote';

/**
 * Recap photo writes (docs/specs/event-recaps-spec.md). The list rides
 * `getStaffEventPage`, so each write refreshes that query. The event id comes
 * from the form body and is the scope every service call checks against.
 */

export const uploadEventPhotos = form(
	z.object({
		eventId: z.string().min(1),
		photos: z.array(z.instanceof(File)).default([])
	}),
	async (data) => {
		const user = await requireCapability('event.manage');
		// An untouched file input still posts one zero-byte File.
		const files = data.photos.filter((f) => f.size > 0);
		await addEventPhotos(data.eventId, user.id, files);
		void getStaffEventPage(data.eventId).refresh();
		return { success: true };
	}
);

export const removeEventPhoto = form(
	z.object({ eventId: z.string().min(1), attachmentId: z.string().min(1) }),
	async (data) => {
		await requireCapability('event.manage');
		await removePhoto(data.eventId, data.attachmentId);
		void getStaffEventPage(data.eventId).refresh();
		return { success: true };
	}
);

export const describeEventPhoto = form(
	z.object({
		eventId: z.string().min(1),
		attachmentId: z.string().min(1),
		altText: z.string().max(300).optional(),
		caption: z.string().max(500).optional()
	}),
	async (data) => {
		await requireCapability('event.manage');
		await describePhoto(data.eventId, data.attachmentId, {
			altText: data.altText?.trim() || null,
			caption: data.caption?.trim() || null
		});
		void getStaffEventPage(data.eventId).refresh();
		return { success: true };
	}
);
