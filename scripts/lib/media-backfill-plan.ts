/**
 * The decisions the media backfill makes, separated from the I/O that feeds it.
 *
 * `scripts/backfill-media.ts` reads D1 and R2; everything it has to get *right*
 * lives here, where it can be tested without either. See
 * docs/specs/shipped/media-spec.md phase 3.
 */

export type AttachableType = 'event_listing' | 'group' | 'user';

export type Source = {
	key: string;
	attachableType: AttachableType;
	attachableId: string;
	slot: string;
	sortOrder: number;
	/** For the dry-run report only. */
	label: string;
};

export type ObjectMeta = { contentType: string; byteSize: number };

export type MediaInsert = {
	id: string;
	key: string;
	contentType: string;
	byteSize: number;
};

export type AttachmentInsert = {
	id: string;
	mediaId: string;
	attachableType: AttachableType;
	attachableId: string;
	slot: string;
	sortOrder: number;
};

export type Plan = {
	media: MediaInsert[];
	attachments: AttachmentInsert[];
	/** Usages whose object no longer exists in R2. Reported, never inserted. */
	missing: Source[];
	/** Usages already recorded by an earlier run. */
	alreadyDone: number;
};

/**
 * Whether a stored value is an R2 key this bucket holds, as opposed to what
 * better-auth may have put in `user.image`: a full URL from an OAuth provider's
 * profile.
 *
 * Only the former can become a `media` row. Recording the latter would invent a
 * key naming nothing, and — because something would point at it — the sweep
 * would then keep that row forever.
 */
export function isR2Key(value: string | null | undefined): boolean {
	if (!value) return false;
	return !/^https?:\/\//i.test(value);
}

/** A usage's identity, for deciding whether an earlier run already recorded it. */
export function attachmentFingerprint(
	mediaId: string,
	attachableType: string,
	attachableId: string,
	slot: string
): string {
	return `${mediaId}|${attachableType}|${attachableId}|${slot}`;
}

/**
 * Decide what to insert.
 *
 * Idempotent by construction rather than by convention: a key already in `media`
 * is reused instead of re-inserted, and a usage already present is skipped, so a
 * re-run after a partial failure completes the job rather than duplicating it.
 *
 * A key whose object is missing produces no rows at all — neither the `media`
 * row nor its attachment. A row with a fabricated size would be worse than no
 * row, since the sweep would preserve it forever while it names nothing.
 */
export function planBackfill(
	sources: Source[],
	existingMediaByKey: Map<string, string>,
	existingAttachments: Set<string>,
	metaByKey: Map<string, ObjectMeta>,
	newId: () => string
): Plan {
	const mediaIdForKey = new Map(existingMediaByKey);
	const media: MediaInsert[] = [];

	// One media row per distinct key, not per usage: many parents sharing one
	// object is the whole point of the table.
	for (const key of new Set(sources.map((s) => s.key))) {
		if (mediaIdForKey.has(key)) continue;
		const meta = metaByKey.get(key);
		if (!meta) continue; // missing in R2 — accounted for below
		const id = newId();
		mediaIdForKey.set(key, id);
		media.push({ id, key, contentType: meta.contentType, byteSize: meta.byteSize });
	}

	const seen = new Set(existingAttachments);
	const attachments: AttachmentInsert[] = [];
	const missing: Source[] = [];
	let alreadyDone = 0;

	for (const s of sources) {
		const mediaId = mediaIdForKey.get(s.key);
		if (!mediaId) {
			missing.push(s);
			continue;
		}
		const fingerprint = attachmentFingerprint(mediaId, s.attachableType, s.attachableId, s.slot);
		if (seen.has(fingerprint)) {
			alreadyDone++;
			continue;
		}
		seen.add(fingerprint);
		attachments.push({
			id: newId(),
			mediaId,
			attachableType: s.attachableType,
			attachableId: s.attachableId,
			slot: s.slot,
			sortOrder: s.sortOrder
		});
	}

	return { media, attachments, missing, alreadyDone };
}
