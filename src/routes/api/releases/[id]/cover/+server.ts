import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireGroupRole } from '$lib/server/group/group-context';
import { uploadFile, validateUpload } from '$lib/server/storage';
import { detachSlot, replaceSlot } from '$lib/server/media/media-service';
import { mediaKey } from '$lib/server/storage-keys';
import { getReleaseById } from '$lib/server/audio/audio-service';

/**
 * The writer the `audio_release`/`cover` slot never had — three readers and a
 * deleter shipped and nothing wrote one (#1072).
 *
 * A route rather than a remote form, matching the event poster and the band
 * avatar: an upload is multipart, and `replaceSlot` releases the previous
 * object rather than deleting it.
 */
async function ownedRelease(releaseId: string, userId: string | undefined) {
	if (!userId) throw error(401, 'Not authenticated');
	const release = await getReleaseById(releaseId);
	if (!release) throw error(404, 'Release not found');
	// The band is resolved from the *release*, never from a caller-supplied id.
	await requireGroupRole({ id: release.groupId }, 'admin', { allowStaff: true });
	return release;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	await ownedRelease(params.id, locals.user?.id);

	const formData = await request.formData();
	const file = formData.get('cover');
	if (!(file instanceof File)) throw error(400, 'No file provided');

	// Validated before anything is written, so a bad upload cannot wipe the
	// cover already there.
	const reason = validateUpload(file);
	if (reason) throw error(400, reason);

	const buffer = await file.arrayBuffer();
	const contentType = file.type;
	const key = mediaKey('releases/covers', params.id, contentType);

	await uploadFile(buffer, key, contentType);

	await replaceSlot({
		attachableType: 'audio_release',
		attachableId: params.id,
		slot: 'cover',
		key,
		contentType,
		byteSize: buffer.byteLength,
		filename: file.name,
		uploadedByUserId: locals.user!.id
	});

	return json({ key });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await ownedRelease(params.id, locals.user?.id);
	await detachSlot('audio_release', params.id, 'cover');
	return json({ success: true });
};
