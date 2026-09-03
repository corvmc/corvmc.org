import { file } from '../../src/lib/server/db/schema/file';
import { documentKey } from '../../src/lib/server/storage-keys';
import { db, env } from './db';
import { type SeedUser } from './types';

/**
 * Documents for the clubs and committees — phase 8 of the groups spec.
 *
 * **Real objects, not just rows.** `getPlatformProxy()` hands back the same
 * `R2_PRIVATE` binding and the same `.wrangler/state/v3` that `vite dev` serves,
 * so a seeded document actually downloads. Seeding a row whose object does not
 * exist would show up as a link that opens a JSON 404, which reads as a broken
 * feature rather than as missing seed data — so the put comes first and the row
 * is only written if it succeeded.
 *
 * Ids are **fixed literals**, which makes `documentKey` deterministic. That
 * matters because `pnpm db:reset` wipes D1 and leaves R2 alone: without stable
 * keys every reset would abandon another set of objects in the local bucket.
 *
 * Bands get nothing here. Documents are a club and committee feature — a band's
 * files are its rider and stage plot, which live in the public `media` slots —
 * and `file-service.upload()` refuses a band outright.
 */

/** A byte-for-byte valid one-page PDF, so the browser opens what it downloads. */
const MINIMAL_PDF = [
	'%PDF-1.4',
	'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
	'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
	'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj',
	'4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
	'5 0 obj<</Length 63>>stream',
	'BT /F1 18 Tf 72 700 Td (Seeded document - not a real record.) Tj ET',
	'endstream endobj',
	'trailer<</Root 1 0 R>>'
].join('\n');

const CHART_CSV = [
	'Tune,Key,Form,Notes',
	'Blue Bossa,Cm,16-bar,Latin into swing on the solos',
	'Autumn Leaves,Gm,32-bar AABC,Trade fours after the head',
	'Song for My Father,Fm,24-bar,Watch the vamp'
].join('\n');

const AGENDA_TXT = [
	'Programming Committee — agenda',
	'',
	'1. Fall showcase: confirm the date and the two holds',
	'2. All-ages policy — deferred from August',
	'3. Side room: what Facilities came back with',
	'4. Anything else'
].join('\n');

interface DocumentSeed {
	/** Fixed, so the R2 key is stable across resets. */
	id: string;
	slug: string;
	filename: string;
	contentType: string;
	body: string;
	description: string | null;
	/** Days ago it was removed. Absent means it is live. */
	deletedDaysAgo?: number;
}

const DOCUMENTS: DocumentSeed[] = [
	{
		id: '11111111-0000-4000-8000-00000000d001',
		slug: 'real-book-club',
		filename: 'charts-august.csv',
		contentType: 'text/csv',
		body: CHART_CSV,
		description: 'What we are reading this month'
	},
	{
		id: '11111111-0000-4000-8000-00000000d002',
		slug: 'real-book-club',
		filename: 'blue-bossa.pdf',
		contentType: 'application/pdf',
		body: MINIMAL_PDF,
		// No description, so the list renders both shapes of row.
		description: null
	},
	{
		id: '11111111-0000-4000-8000-00000000d003',
		slug: 'programming-committee',
		filename: 'agenda-september.txt',
		contentType: 'text/plain',
		body: AGENDA_TXT,
		description: 'Draft agenda for the next meeting'
	},
	{
		id: '11111111-0000-4000-8000-00000000d004',
		slug: 'programming-committee',
		filename: 'minutes-august.pdf',
		contentType: 'application/pdf',
		body: MINIMAL_PDF,
		description: 'Approved 26 August'
	},
	{
		// Removed, and inside the seven-day grace window: it is absent from the
		// list (which is how you see the filter working) and it is not yet a sweep
		// candidate, which is how you see the window working.
		id: '11111111-0000-4000-8000-00000000d005',
		slug: 'programming-committee',
		filename: 'minutes-august-draft.pdf',
		contentType: 'application/pdf',
		body: MINIMAL_PDF,
		description: 'Superseded by the approved copy',
		deletedDaysAgo: 2
	}
];

export async function seedGroupDocuments(
	groups: { id: string; slug: string }[],
	users: SeedUser[]
) {
	console.log('Seeding group documents...');

	const bucket = env.R2_PRIVATE as R2Bucket | undefined;
	if (!bucket) {
		console.warn('  R2_PRIVATE is not bound — skipping documents.');
		return [];
	}

	const bySlug = new Map(groups.map((g) => [g.slug, g]));
	const uploader = users[0];
	const rows = [];

	for (const doc of DOCUMENTS) {
		const group = bySlug.get(doc.slug);
		if (!group) continue;

		const key = documentKey(group.id, doc.id, doc.contentType);
		const bytes = new TextEncoder().encode(doc.body);

		try {
			await bucket.put(key, bytes, { httpMetadata: { contentType: doc.contentType } });
		} catch (err) {
			// Skip the row rather than leave a download that 404s.
			console.warn(`  could not store ${doc.filename}:`, err);
			continue;
		}

		const [row] = await db
			.insert(file)
			.values({
				id: doc.id,
				groupId: group.id,
				key,
				filename: doc.filename,
				contentType: doc.contentType,
				sizeBytes: bytes.byteLength,
				description: doc.description,
				uploadedById: uploader.id,
				deletedAt:
					doc.deletedDaysAgo === undefined
						? null
						: new Date(Date.now() - doc.deletedDaysAgo * 86400000)
			})
			.returning();
		rows.push(row);
	}

	return rows;
}
