import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { form } from './_remote';
import { requireCapability, requireUser } from '$lib/server/authorization';
import {
	addEventPhotos,
	describeEventPhoto as describePhoto,
	removeEventPhoto as removePhoto
} from '$lib/server/event/event-photo-service';
import { recapUploadAccess } from '$lib/server/event/recap-access';
import { getPublicEventDetail, getStaffEventPage } from '$lib/remote/events.remote';

/**
 * Recap photo writes (docs/specs/event-recaps-spec.md). The event id comes from
 * the form body and is the scope every service call checks against. Uploading
 * is open to volunteer photographers; editing and removing stay `event.manage`.
 */

async function requireRecapUploader() {
	const user = requireUser();
	const access = await recapUploadAccess(user.id);
	if (!access) error(403, 'Not permitted');
	return { user, staff: access === 'capability' };
}

export const uploadEventPhotos = form(
	z.object({
		eventId: z.string().min(1),
		photos: z.array(z.instanceof(File)).default([])
	}),
	async (data) => {
		const { user, staff } = await requireRecapUploader();
		// An untouched file input still posts one zero-byte File.
		const files = data.photos.filter((f) => f.size > 0);
		await addEventPhotos(data.eventId, user.id, files);
		void getPublicEventDetail(data.eventId).refresh();
		if (staff) void getStaffEventPage(data.eventId).refresh();
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
