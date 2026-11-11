import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { group } from '#lib/server/db/schema/group.js';
import { eq } from 'drizzle-orm';
import { requireGroupRole } from '#lib/server/group/group-context.js';
import { uploadFile, validateUpload } from '#lib/server/storage.js';
import { detachSlot, replaceSlot } from '#lib/server/media/media-service.js';
import { mediaKey } from '#lib/server/storage-keys.js';

// ---------------------------------------------------------------------------
// POST — upload avatar
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ params, request }) => {
	// The id is a real route param here, not a remote function's client-supplied
	// one, so `{ id }` is the honest ref. The guard does the 401, the 404 and the
	// role check that were three hand-rolled steps.
	const bandId = params.id;
	const { user } = await requireGroupRole({ id: bandId }, 'admin');

	const formData = await request.formData();
	const file = formData.get('file') as File | null;

	if (!file || !(file instanceof File)) {
		throw error(400, 'No file provided');
	}

	// Validate before mutating anything so a bad upload doesn't wipe the existing avatar.
	const reason = validateUpload(file);
	if (reason) throw error(400, reason);

	const buffer = await file.arrayBuffer();
	const key = mediaKey('bands/avatars', bandId, file.type);

	await uploadFile(buffer, key, file.type);

	// Records the object and releases the old one. Nothing here deletes: see
	// docs/decisions/NNNN-uploads-are-detached-and-swept.md.
	await replaceSlot({
		attachableType: 'group',
		attachableId: bandId,
		slot: 'avatar',
		key,
		contentType: file.type,
		byteSize: buffer.byteLength,
		filename: file.name,
		uploadedByUserId: user.id
	});

	await db.update(group).set({ avatarKey: key, updatedAt: new Date() }).where(eq(group.id, bandId));

	return Response.json({ success: true, avatarKey: key });
};

// ---------------------------------------------------------------------------
// DELETE — remove avatar
// ---------------------------------------------------------------------------

export const DELETE: RequestHandler = async ({ params }) => {
	const bandId = params.id;
	await requireGroupRole({ id: bandId }, 'admin');

	await detachSlot('group', bandId, 'avatar');

	await db
		.update(group)
		.set({ avatarKey: null, updatedAt: new Date() })
		.where(eq(group.id, bandId));

	return Response.json({ success: true });
};
