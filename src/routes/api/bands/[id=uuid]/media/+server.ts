import { json, error, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { group } from '$lib/server/db/schema/group';
import { mediaAttachment } from '$lib/server/db/schema/media';
import type { MediaSlot } from '$lib/server/db/schema/media';
import { eq, and, max } from 'drizzle-orm';
import { getUserRole } from '$lib/server/band/band-service';
import { uploadFile } from '$lib/server/storage';
import { extensionForType } from '$lib/server/storage-keys';
import { attach, detach, record } from '$lib/server/media/media-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_PER_UPLOAD = 10;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Tech riders and stage plots may also be PDFs
const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];
const ALLOWED_MEDIA_TYPES = ['image', 'hero', 'rider', 'stage_plot'] as const;

/**
 * The request vocabulary is `band_media.type`, which the media tables renamed
 * on the way in — 'image' became 'gallery'. Kept as a mapping rather than a
 * rename of the API field so the page editor's four upload buttons, and any
 * link already pointing at this endpoint, keep working unchanged.
 */
const SLOT_FOR_MEDIA_TYPE: Record<(typeof ALLOWED_MEDIA_TYPES)[number], MediaSlot> = {
	image: 'gallery',
	hero: 'hero',
	rider: 'rider',
	stage_plot: 'stage_plot'
};

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
	const [row] = await db.select({ id: group.id }).from(group).where(eq(group.id, bandId)).limit(1);
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

	const slot = SLOT_FOR_MEDIA_TYPE[mediaType as (typeof ALLOWED_MEDIA_TYPES)[number]];

	// Current max sortOrder for this band's slot
	const [maxSort] = await db
		.select({ maxOrder: max(mediaAttachment.sortOrder) })
		.from(mediaAttachment)
		.where(
			and(
				eq(mediaAttachment.attachableType, 'group'),
				eq(mediaAttachment.attachableId, bandId),
				eq(mediaAttachment.slot, slot)
			)
		);

	let sortOrder = (maxSort?.maxOrder ?? -1) + 1;

	const uploaded: Array<{ id: string; key: string; sortOrder: number }> = [];

	for (const file of files) {
		const buffer = await file.arrayBuffer();
		const ext = extensionForType(file.type);
		const fileId = crypto.randomUUID();
		const key = `bands/${bandId}/media/${mediaType}/${fileId}.${ext}`;

		await uploadFile(buffer, key, file.type, allowedTypes);

		// Record the object, then point the band at it. Two steps deliberately:
		// an upload that is never attached is a representable state the sweep can
		// still reclaim, rather than an object nothing knows about.
		const mediaRow = await record({
			key,
			contentType: file.type,
			byteSize: buffer.byteLength,
			filename: file.name,
			caption: files.length === 1 ? (caption ?? null) : null,
			uploadedByUserId: locals.user.id
		});

		const attachment = await attach({
			mediaId: mediaRow.id,
			attachableType: 'group',
			attachableId: bandId,
			slot,
			sortOrder: sortOrder++
		});

		// The attachment id, which is what DELETE below takes. This used to return
		// the uuid embedded in the key — a different value from the row's id, so a
		// caller that fed it straight back got a 404.
		uploaded.push({ id: attachment.id, key, sortOrder: sortOrder - 1 });
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

	// Scoped to this band, so an attachment id from another group's media cannot
	// be detached by passing it here.
	const [row] = await db
		.select({ id: mediaAttachment.id })
		.from(mediaAttachment)
		.where(
			and(
				eq(mediaAttachment.id, mediaId),
				eq(mediaAttachment.attachableType, 'group'),
				eq(mediaAttachment.attachableId, bandId)
			)
		)
		.limit(1);

	if (!row) throw error(404, 'Media not found');

	// Detach only. Nothing here deletes the R2 object: another band, or another
	// slot, may still point at it, and only `/api/cron/sweep-media` can see the
	// whole reference graph. See docs/specs/shipped/media-spec.md.
	await detach(row.id);

	return json({ success: true });
};
