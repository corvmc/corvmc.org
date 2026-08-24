import { json, error, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { band } from '$lib/server/db/schema/band';
import { bandMedia } from '$lib/server/db/schema/band-page';
import { eq, and, max } from 'drizzle-orm';
import { getUserRole } from '$lib/server/band/band-service';
import { uploadFile, deleteObject } from '$lib/server/storage';
import { extensionForType } from '$lib/server/storage-keys';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_PER_UPLOAD = 10;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Tech riders and stage plots may also be PDFs
const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];
const ALLOWED_MEDIA_TYPES = ['image', 'hero', 'rider', 'stage_plot'] as const;

function allowedTypesFor(mediaType: string): string[] {
	return mediaType === 'rider' || mediaType === 'stage_plot' ? DOCUMENT_TYPES : IMAGE_TYPES;
}

async function requireAdminOfBand(bandId: string, userId: string) {
	const role = await getUserRole(bandId, userId);
	if (!role || (role !== 'owner' && role !== 'admin')) {
		throw error(403, 'Only owners and admins can manage band media');
	}
}

// ---------------------------------------------------------------------------
// POST — upload one or more media files
// ---------------------------------------------------------------------------
// FormData fields:
//   file (or file[]) — the image files to upload
//   type — 'image' | 'hero' | 'rider' | 'stage_plot'
//   caption — optional caption (only applies to single-file uploads)
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const bandId = params.id!;
	const [row] = await db.select({ id: band.id }).from(band).where(eq(band.id, bandId)).limit(1);
	if (!row) throw error(404, 'Band not found');

	await requireAdminOfBand(bandId, locals.user.id);

	const formData = await request.formData();
	const mediaType = (formData.get('type') as string) ?? 'image';
	const caption = formData.get('caption') as string | null;

	if (!ALLOWED_MEDIA_TYPES.includes(mediaType as (typeof ALLOWED_MEDIA_TYPES)[number])) {
		throw error(400, `Invalid media type. Must be one of: ${ALLOWED_MEDIA_TYPES.join(', ')}`);
	}

	// Collect all files from the form data
	const files: File[] = [];
	for (const [key, value] of formData.entries()) {
		if ((key === 'file' || key === 'file[]') && value instanceof File) {
			files.push(value);
		}
	}

	if (files.length === 0) {
		throw error(400, 'No files provided');
	}

	if (files.length > MAX_FILES_PER_UPLOAD) {
		throw error(400, `Maximum ${MAX_FILES_PER_UPLOAD} files per upload`);
	}

	// Validate all files before uploading any
	const allowedTypes = allowedTypesFor(mediaType);
	for (const file of files) {
		if (file.size > MAX_FILE_SIZE) {
			throw error(400, `File "${file.name}" exceeds maximum size of 10MB`);
		}
		if (!allowedTypes.includes(file.type)) {
			throw error(
				400,
				`File "${file.name}" has unsupported type. Allowed: JPEG, PNG, WebP, GIF${
					allowedTypes.includes('application/pdf') ? ', PDF' : ''
				}`
			);
		}
	}

	// For hero/rider/stage_plot types, only allow a single file
	if (mediaType !== 'image' && files.length > 1) {
		throw error(400, `Only one file allowed for type "${mediaType}"`);
	}

	// Get current max sortOrder for this band+type
	const [maxSort] = await db
		.select({ maxOrder: max(bandMedia.sortOrder) })
		.from(bandMedia)
		.where(and(eq(bandMedia.bandId, bandId), eq(bandMedia.type, mediaType)));

	let sortOrder = (maxSort?.maxOrder ?? -1) + 1;

	const uploaded: Array<{ id: string; key: string; sortOrder: number }> = [];

	for (const file of files) {
		const buffer = await file.arrayBuffer();
		const ext = extensionForType(file.type);
		const fileId = crypto.randomUUID();
		const key = `bands/${bandId}/media/${mediaType}/${fileId}.${ext}`;

		await uploadFile(buffer, key, file.type, allowedTypes);

		await db.insert(bandMedia).values({
			bandId,
			key,
			type: mediaType,
			caption: files.length === 1 ? (caption ?? undefined) : undefined,
			sortOrder: sortOrder++
		});

		uploaded.push({ id: fileId, key, sortOrder: sortOrder - 1 });
	}

	return json({ success: true, media: uploaded });
};

// ---------------------------------------------------------------------------
// DELETE — remove a media item by its key (passed as query param)
// ---------------------------------------------------------------------------
// Usage: DELETE /api/bands/:id/media?mediaId=<uuid>
// ---------------------------------------------------------------------------

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const bandId = params.id!;
	await requireAdminOfBand(bandId, locals.user.id);

	const mediaId = url.searchParams.get('mediaId');
	if (!mediaId) throw error(400, 'Missing mediaId query parameter');

	const [row] = await db
		.select({ id: bandMedia.id, key: bandMedia.key })
		.from(bandMedia)
		.where(and(eq(bandMedia.id, mediaId), eq(bandMedia.bandId, bandId)))
		.limit(1);

	if (!row) throw error(404, 'Media not found');

	// Delete from R2
	try {
		await deleteObject(row.key);
	} catch {
		// Object may not exist in storage — proceed with DB cleanup
	}

	// Delete from DB
	await db.delete(bandMedia).where(eq(bandMedia.id, mediaId));

	return json({ success: true });
};
