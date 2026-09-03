import { and, count, desc, eq, isNull, isNotNull, lt, sum, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { file } from '$lib/server/db/schema/file';
import { user } from '$lib/server/db/schema/authentication';
import { group } from '$lib/server/db/schema/group';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { DomainError } from '$lib/server/domain-error';
import {
	putPrivateObject,
	validatePrivateUpload,
	MAX_DOCUMENT_BYTES
} from '$lib/server/private-storage';
import { documentKey, sanitizeFilename } from '$lib/server/storage-keys';

/**
 * Group documents — a file store, not a document tool. Phase 8 of
 * `docs/specs/groups-spec.md`.
 *
 * Group-scoped by argument, exactly as `announcement-service.ts` is: every
 * function takes a `groupId` and every write is scoped to it. Nothing here
 * guards *identity* — that is `requireGroupRole`'s job at the remote boundary,
 * and doing it in both places is how two answers to "may this person upload"
 * come to disagree. What it does decide is **policy**: which kinds of group may
 * hold documents at all, and how much.
 *
 * Objects live in the private bucket and are reached only through
 * `/api/files/[id]`, which authorizes against the file's own stored `groupId`.
 * Nothing in this module returns anything a caller could turn into a URL.
 */

/**
 * The hard cap on a list, matching `announcement-service.ts`: there is no
 * pagination yet, and an uncapped read of a decade of committee minutes is not
 * a query anyone chose.
 */
const MAX_LIST = 100;

/**
 * Per group, and flat across kinds. Service constants rather than per-group
 * columns until someone asks for tiering — a column would need a staff control,
 * a migration and a default, and none of that is bought by a number nobody has
 * yet wanted to change.
 */
export const DOCUMENT_QUOTA_BYTES = 250 * 1024 * 1024;
export const DOCUMENT_QUOTA_FILES = 50;

export class FileNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Document not found');
		this.name = 'FileNotFoundError';
	}
}

/**
 * The group is a band.
 *
 * Bands get no general file storage: what a band actually holds is a rider and
 * a stage plot, and both already have `media` slots served from the public
 * bucket through `/api/bands/[id]/media`. The check lives here rather than only
 * in the remote function so that a second caller — a staff tool, a backfill, an
 * import — cannot route around it.
 */
export class DocumentsNotAvailableError extends DomainError {
	readonly httpStatus = 422;

	constructor() {
		super('Documents are for clubs and committees. A band holds its rider and stage plot instead.');
		this.name = 'DocumentsNotAvailableError';
	}
}

export class QuotaExceededError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'QuotaExceededError';
	}
}

/** Type or size, as `validatePrivateUpload` reported it. The reason is shown to the uploader. */
export class InvalidDocumentError extends DomainError {
	readonly httpStatus = 415;

	constructor(message: string) {
		super(message);
		this.name = 'InvalidDocumentError';
	}
}

/**
 * R2 refused to delete during a hard group delete, which **aborts** the delete.
 *
 * A 500 rather than a 4xx: it is a storage fault, not a request the caller could
 * have made differently. The surviving rows are then the recovery record, which
 * is the whole reason the purge runs before the cascade.
 */
export class DocumentPurgeFailedError extends DomainError {
	readonly httpStatus = 500;

	constructor(failedCount: number) {
		super(
			`Could not delete ${failedCount} stored file(s). Nothing was removed — try again in a moment.`
		);
		this.name = 'DocumentPurgeFailedError';
	}
}

export interface UploadDocumentData {
	file: File;
	description?: string | null;
}

/** The columns every read returns, with the uploader resolved to a member ref. */
function selectColumns() {
	return {
		id: file.id,
		groupId: file.groupId,
		filename: file.filename,
		contentType: file.contentType,
		sizeBytes: file.sizeBytes,
		description: file.description,
		createdAt: file.createdAt,
		updatedAt: file.updatedAt,
		uploadedBy: memberRefColumns()
	};
}

/**
 * Note what is absent: `key`. It is the one column no client ever needs, and
 * leaving it out of the shaped view means no surface can leak it by accident
 * into a payload someone later hands to `resolveImageUrl`.
 */
function runSelect(where: ReturnType<typeof and>) {
	return db
		.select(selectColumns())
		.from(file)
		.leftJoin(user, eq(user.id, file.uploadedById))
		.where(where)
		.orderBy(desc(file.createdAt))
		.limit(MAX_LIST);
}

type Row = Awaited<ReturnType<typeof runSelect>>[number];

function shape(row: Row) {
	return {
		id: row.id,
		groupId: row.groupId,
		filename: row.filename,
		contentType: row.contentType,
		sizeBytes: row.sizeBytes,
		description: row.description,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		// Null once the uploader's account is gone. The document is still the group's.
		uploadedBy: row.uploadedBy?.id ? toMemberRef(row.uploadedBy) : null
	};
}

export type FileView = ReturnType<typeof shape>;

export interface DocumentUsage {
	usedBytes: number;
	fileCount: number;
	quotaBytes: number;
	quotaFiles: number;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** What every member of the group sees. Soft-deleted rows are simply gone. */
export async function list(groupId: string): Promise<FileView[]> {
	const rows = await runSelect(and(eq(file.groupId, groupId), isNull(file.deletedAt)));
	return rows.map(shape);
}

/**
 * What the group has spent, and what it is allowed.
 *
 * The quota constants ride the return rather than being imported by the
 * component, because a `.svelte` importing a server module is a client bundle
 * that will not build. It is also a second statement rather than a sum over
 * `list()` — that list is capped at `MAX_LIST`, so deriving usage from it would
 * silently under-report the moment a group passes the cap.
 */
export async function getUsage(groupId: string): Promise<DocumentUsage> {
	const [row] = await db
		.select({ used: sum(file.sizeBytes), files: count() })
		.from(file)
		.where(and(eq(file.groupId, groupId), isNull(file.deletedAt)));

	return {
		// `sum()` is null over an empty set, and comes back as a string from D1.
		usedBytes: Number(row?.used ?? 0),
		fileCount: row?.files ?? 0,
		quotaBytes: DOCUMENT_QUOTA_BYTES,
		quotaFiles: DOCUMENT_QUOTA_FILES
	};
}

/**
 * The download route's read, and the only function here that takes an id alone.
 *
 * It cannot take a `groupId`, because the route has no group until it reads this
 * row — and that is exactly the point: the group the route authorizes against
 * comes from stored state and never from the request. Returns null for a
 * soft-deleted row, so a removed document is indistinguishable from one that
 * never existed to a caller who has not been authorized for anything yet.
 */
export async function getForDownload(id: string) {
	const [row] = await db
		.select({
			id: file.id,
			groupId: file.groupId,
			key: file.key,
			filename: file.filename,
			contentType: file.contentType,
			sizeBytes: file.sizeBytes
		})
		.from(file)
		.where(and(eq(file.id, id), isNull(file.deletedAt)))
		.limit(1);

	return row ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record a document and store its bytes.
 *
 * The order is load-bearing, and it is the **inverse** of every delete path:
 *
 *   1. policy — a band may not hold documents
 *   2. validation — type and size
 *   3. quota — file count, then bytes
 *   4. insert the row
 *   5. put the object
 *
 * Row before object, because the row is the only record of the key. Putting the
 * object first and then failing the insert strands a file that is billed forever
 * with nothing that knows its name. Failing the *put* after the insert leaves a
 * row pointing at nothing, which is recoverable: it is soft-deleted here, and
 * the sweep's later delete of a key R2 never had is a no-op success.
 */
export async function upload(
	groupId: string,
	uploaderId: string,
	data: UploadDocumentData
): Promise<FileView> {
	const [owner] = await db
		.select({ kind: group.kind })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);
	if (!owner) throw new FileNotFoundError();
	if (owner.kind === 'band') throw new DocumentsNotAvailableError();

	const invalid = validatePrivateUpload(data.file);
	if (invalid) throw new InvalidDocumentError(invalid);

	// Read-then-write with no transaction, because `db.transaction` is banned and
	// broken on D1 alike. Two simultaneous uploads can therefore both pass a
	// check taken at 249MB. The overshoot is bounded by MAX_DOCUMENT_BYTES per
	// racer, and the alternative — a counter column — buys a smaller race and a
	// new way for the count to drift from the rows.
	const usage = await getUsage(groupId);
	if (usage.fileCount >= DOCUMENT_QUOTA_FILES) {
		throw new QuotaExceededError(
			`This group is at its limit of ${DOCUMENT_QUOTA_FILES} documents. Remove one to upload another.`
		);
	}
	if (usage.usedBytes + data.file.size > DOCUMENT_QUOTA_BYTES) {
		throw new QuotaExceededError(
			`This group has ${formatMb(DOCUMENT_QUOTA_BYTES - usage.usedBytes)} of storage left, and this file is ${formatMb(data.file.size)}.`
		);
	}

	const id = crypto.randomUUID();
	const key = documentKey(groupId, id, data.file.type);
	const filename = sanitizeFilename(data.file.name);
	const description = data.description?.trim() || null;

	await db.insert(file).values({
		id,
		groupId,
		key,
		filename,
		contentType: data.file.type,
		sizeBytes: data.file.size,
		description,
		uploadedById: uploaderId
	});

	try {
		await putPrivateObject(key, await data.file.arrayBuffer(), data.file.type);
	} catch (err) {
		// The row would otherwise sit in the list as a download that 404s, and
		// count against the quota for a file nobody has.
		await db.update(file).set({ deletedAt: new Date() }).where(eq(file.id, id));
		throw err;
	}

	const [row] = await runSelect(and(eq(file.id, id), eq(file.groupId, groupId)));
	return shape(row);
}

/**
 * Remove a document. Sets `deletedAt` and touches **no** R2 object.
 *
 * A delete that fires from a request path cannot see whether anything else still
 * references the object, and if the R2 call fails after the row is gone the file
 * is stranded with no record of its key. So the row is the audit record until
 * the sweep reclaims the object — `file-sweep.ts` — and the quota stops counting
 * it immediately, because that read filters to live rows.
 */
export async function remove(id: string, groupId: string): Promise<void> {
	const result = await db
		.update(file)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(file.id, id), eq(file.groupId, groupId), isNull(file.deletedAt)))
		.returning({ id: file.id });

	if (result.length === 0) throw new FileNotFoundError();
}

// ---------------------------------------------------------------------------
// The reaper's and the hard delete's reads
// ---------------------------------------------------------------------------

/**
 * Every key this group holds, **live and soft-deleted alike**.
 *
 * For `deleteBand`, which is about to cascade these rows away. Soft-deleted rows
 * are included precisely because they are the ones the sweep would otherwise
 * have handled — once the group is gone, it never gets the chance.
 */
export async function listAllKeys(groupId: string): Promise<{ id: string; key: string }[]> {
	return await db
		.select({ id: file.id, key: file.key })
		.from(file)
		.where(eq(file.groupId, groupId));
}

/** Soft-deleted longer ago than `cutoff`. The sweep's candidates. */
export async function listSweepCandidates(cutoff: Date): Promise<{ id: string; key: string }[]> {
	return await db
		.select({ id: file.id, key: file.key })
		.from(file)
		.where(and(isNotNull(file.deletedAt), lt(file.deletedAt, cutoff)));
}

/** Chunked at 90: D1 caps a statement at 100 bound parameters. */
export async function deleteRows(ids: string[]): Promise<void> {
	const CHUNK = 90;
	for (let i = 0; i < ids.length; i += CHUNK) {
		await db.delete(file).where(inArray(file.id, ids.slice(i, i + CHUNK)));
	}
}

function formatMb(bytes: number): string {
	return `${(Math.max(0, bytes) / 1024 / 1024).toFixed(1)}MB`;
}

/** Re-exported so a caller sizing an input does not have to import two modules. */
export { MAX_DOCUMENT_BYTES };
