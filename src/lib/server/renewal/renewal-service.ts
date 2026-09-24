import { db } from '$lib/server/db';
import { renewal, type NewRenewal, type Renewal } from '$lib/server/db/schema/renewal';
import { user } from '$lib/server/db/schema/authentication';
import { media, mediaAttachment } from '$lib/server/db/schema/media';
import { and, eq, gte, lte } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { listFor } from '$lib/server/media/media-service';
import { putPrivateObject, validatePrivateUpload } from '$lib/server/private-storage';
import { renewalDocumentKey, sanitizeFilename } from '$lib/server/storage-keys';
import type { RenewalKind } from '$lib/config';
import { byDeadline, due, type Deadline } from '$lib/utils/deadline';

export class RenewalNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Renewal not found');
	}
}

export class RenewalDocumentRejectedError extends DomainError {
	readonly httpStatus = 422;
}

export type RenewalDeadline = Deadline<RenewalKind>;

type RenewalRow = Pick<Renewal, 'id' | 'name' | 'kind' | 'expiresOn'>;

/** Whole calendar days from `today` to `on`; negative once it has passed. */
function daysBetween(today: string, on: string): number {
	return Math.round(
		(Date.parse(`${on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
	);
}

function withDeadline<R extends RenewalRow>(r: R, today: string) {
	return {
		...r,
		deadline: due(r.kind, r.expiresOn, today),
		daysLeft: daysBetween(today, r.expiresOn)
	};
}

/** Every renewal with its expiry as a deadline, soonest first, lapsed ones in front. */
export function summarizeRenewals<R extends RenewalRow>(rows: R[], today: string) {
	return rows.map((r) => withDeadline(r, today)).sort(byDeadline((r) => r.name));
}

const summaryColumns = {
	id: renewal.id,
	name: renewal.name,
	kind: renewal.kind,
	issuer: renewal.issuer,
	reference: renewal.reference,
	expiresOn: renewal.expiresOn,
	responsibleUserId: renewal.responsibleUserId,
	responsibleName: user.name,
	notes: renewal.notes
};

export async function listRenewals(today: string) {
	const rows = await db
		.select(summaryColumns)
		.from(renewal)
		.leftJoin(user, eq(user.id, renewal.responsibleUserId));
	return summarizeRenewals(rows, today);
}

/** Every renewal expiring on a day in `[from, to]`, with who to tell. */
export async function listRenewalsExpiringBetween(from: string, to: string) {
	return db
		.select({ ...summaryColumns, responsibleEmail: user.email })
		.from(renewal)
		.leftJoin(user, eq(user.id, renewal.responsibleUserId))
		.where(and(gte(renewal.expiresOn, from), lte(renewal.expiresOn, to)));
}

/** One renewal and its documents. A document is linked by attachment, never by key. */
export async function getRenewal(id: string, today: string) {
	const [row] = await db
		.select(summaryColumns)
		.from(renewal)
		.leftJoin(user, eq(user.id, renewal.responsibleUserId))
		.where(eq(renewal.id, id))
		.limit(1);
	if (!row) throw new RenewalNotFoundError();
	const docs = await listFor('renewal', id, 'certificate');
	return {
		...withDeadline(row, today),
		documents: docs.map((d) => ({
			attachmentId: d.attachmentId,
			filename: d.filename,
			url: `/api/renewals/documents/${d.attachmentId}`
		}))
	};
}

export type RenewalInput = Omit<NewRenewal, 'id' | 'createdAt' | 'updatedAt'>;

export async function createRenewal(input: RenewalInput): Promise<Renewal> {
	const [row] = await db.insert(renewal).values(input).returning();
	return row;
}

export async function updateRenewal(id: string, input: RenewalInput): Promise<void> {
	const rows = await db
		.update(renewal)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(renewal.id, id))
		.returning({ id: renewal.id });
	if (rows.length === 0) throw new RenewalNotFoundError();
}

/** Its documents' attachments are orphaned and swept with their objects. */
export async function deleteRenewal(id: string): Promise<void> {
	const rows = await db.delete(renewal).where(eq(renewal.id, id)).returning({ id: renewal.id });
	if (rows.length === 0) throw new RenewalNotFoundError();
}

/**
 * Write a certificate to the private bucket and attach it. The existence check
 * comes before the write: an object put for a renewal that is gone has no
 * `media` row, so the sweep could never find it.
 */
export async function uploadRenewalDocument(input: {
	renewalId: string;
	file: File;
	uploadedByUserId: string;
}) {
	const invalid = validatePrivateUpload(input.file);
	if (invalid) throw new RenewalDocumentRejectedError(invalid);
	const [exists] = await db
		.select({ id: renewal.id })
		.from(renewal)
		.where(eq(renewal.id, input.renewalId))
		.limit(1);
	if (!exists) throw new RenewalNotFoundError();

	const key = renewalDocumentKey(input.renewalId, input.file.type);
	await putPrivateObject(key, await input.file.arrayBuffer(), input.file.type);

	const [m] = await db
		.insert(media)
		.values({
			key,
			contentType: input.file.type,
			byteSize: input.file.size,
			filename: sanitizeFilename(input.file.name),
			uploadedByUserId: input.uploadedByUserId
		})
		.returning({ id: media.id });
	await db.insert(mediaAttachment).values({
		mediaId: m.id,
		attachableType: 'renewal',
		attachableId: input.renewalId,
		slot: 'certificate'
	});
}

/** The object behind one renewal document, or null for any other attachment. */
export async function getRenewalDocument(attachmentId: string) {
	const [row] = await db
		.select({ key: media.key, contentType: media.contentType, filename: media.filename })
		.from(mediaAttachment)
		.innerJoin(media, eq(media.id, mediaAttachment.mediaId))
		.where(
			and(
				eq(mediaAttachment.id, attachmentId),
				eq(mediaAttachment.attachableType, 'renewal'),
				eq(mediaAttachment.slot, 'certificate')
			)
		)
		.limit(1);
	return row ?? null;
}

/** Detach one document from this renewal. The sweep reaps the object. */
export async function removeRenewalDocument(renewalId: string, attachmentId: string) {
	const rows = await db
		.delete(mediaAttachment)
		.where(
			and(
				eq(mediaAttachment.id, attachmentId),
				eq(mediaAttachment.attachableType, 'renewal'),
				eq(mediaAttachment.attachableId, renewalId)
			)
		)
		.returning({ id: mediaAttachment.id });
	if (rows.length === 0) throw new RenewalNotFoundError();
}
