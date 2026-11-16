import { db } from '#lib/server/db/index.js';
import { reminderSent } from '#lib/server/db/schema/reminder.js';
import { and, eq, inArray } from 'drizzle-orm';

// D1 caps a statement at 100 bound parameters.
const CHUNK = 90;

/**
 * Which of these subjects this key has already been sent for. Chunked: a busy
 * Saturday can put more reservations than one statement holds inside a window.
 */
export async function alreadySentFor(key: string, subjectIds: string[]): Promise<Set<string>> {
	const seen = new Set<string>();
	for (let i = 0; i < subjectIds.length; i += CHUNK) {
		const rows = await db
			.select({ subjectId: reminderSent.subjectId })
			.from(reminderSent)
			.where(
				and(
					eq(reminderSent.reminderKey, key),
					inArray(reminderSent.subjectId, subjectIds.slice(i, i + CHUNK))
				)
			);
		for (const row of rows) seen.add(row.subjectId);
	}
	return seen;
}

/** Record subjects as sent; one already recorded stays as it was. */
export async function markAllSent(
	key: string,
	subjectType: string,
	subjectIds: string[]
): Promise<void> {
	// Three bound parameters a row.
	for (let i = 0; i < subjectIds.length; i += 30) {
		await db
			.insert(reminderSent)
			.values(
				subjectIds
					.slice(i, i + 30)
					.map((subjectId) => ({ reminderKey: key, subjectType, subjectId }))
			)
			.onConflictDoNothing();
	}
}
