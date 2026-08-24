import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { band } from '$lib/server/db/schema/band';
import { eq } from 'drizzle-orm';
import { getUserRole } from '$lib/server/band/band-service';
import { uploadFile, deleteObject, validateUpload } from '$lib/server/storage';
import { mediaKey } from '$lib/server/storage-keys';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireAdminOfBand(bandId: string, userId: string) {
	const role = await getUserRole(bandId, userId);
	if (!role || (role !== 'owner' && role !== 'admin')) {
		throw error(403, 'Only owners and admins can manage the avatar');
	}
}

// ---------------------------------------------------------------------------
// POST — upload avatar
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const bandId = params.id;
	const [row] = await db.select().from(band).where(eq(band.id, bandId)).limit(1);
	if (!row) throw error(404, 'Band not found');

	await requireAdminOfBand(bandId, locals.user.id);

	const formData = await request.formData();
	const file = formData.get('file') as File | null;

	if (!file || !(file instanceof File)) {
		throw error(400, 'No file provided');
	}

	// Validate before mutating anything so a bad upload doesn't wipe the existing avatar.
	const reason = validateUpload(file);
	if (reason) throw error(400, reason);

	// Delete old avatar if exists
	if (row.avatarKey) {
		try {
			await deleteObject(row.avatarKey);
		} catch {
			// Old avatar may not exist — that's fine
		}
	}

	const buffer = await file.arrayBuffer();
	const key = mediaKey('bands/avatars', bandId, file.type);

	await uploadFile(buffer, key, file.type);

	await db.update(band).set({ avatarKey: key, updatedAt: new Date() }).where(eq(band.id, bandId));

	return json({ success: true, avatarKey: key });
};

// ---------------------------------------------------------------------------
// DELETE — remove avatar
// ---------------------------------------------------------------------------

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const bandId = params.id;
	const [row] = await db.select().from(band).where(eq(band.id, bandId)).limit(1);
	if (!row) throw error(404, 'Band not found');

	await requireAdminOfBand(bandId, locals.user.id);

	if (row.avatarKey) {
		try {
			await deleteObject(row.avatarKey);
		} catch {
			// Avatar may not exist — that's fine
		}
	}

	await db.update(band).set({ avatarKey: null, updatedAt: new Date() }).where(eq(band.id, bandId));

	return json({ success: true });
};
