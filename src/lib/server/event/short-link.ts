import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { normalizeShortCode } from '#lib/event-short-code.js';

/** The event a printed `/e/<code>` names, or null for a code nobody holds. */
export async function eventIdByShortCode(input: string): Promise<string | null> {
	const code = normalizeShortCode(input);
	if (!code) return null;
	const [row] = await db
		.select({ id: eventListing.id })
		.from(eventListing)
		.where(eq(eventListing.shortCode, code))
		.limit(1);
	return row?.id ?? null;
}
