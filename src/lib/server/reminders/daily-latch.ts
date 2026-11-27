import { desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { reminderSent } from '#lib/server/db/schema/reminder.js';
import { clubToday } from '#lib/config.js';
import { clubInstant } from '#lib/utils/format.js';

/**
 * A once-a-day pass, latched in `reminder_sent` by club date. The row is
 * written in the same `db.batch` as the pass's output, so a racing or repeated
 * pass finds the day taken and does nothing. Open shifts (#3258) and the in-app
 * digest (#3409) each own a key.
 */

/** Club wall-clock time the pass goes out. A later pass that day still runs. */
export const DIGEST_TIME = '09:00';

/** The first pass's lookback, when no earlier pass exists: the backlog is not news. */
const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface DigestWindow {
	/** The club date this pass is for. */
	day: string;
	/** What happened at or after this goes in: the previous pass's `now`. */
	since: Date;
}

/**
 * Whether today's pass is owed under `key`: it is 9am or later in club time and
 * no pass has run for today's club date. Null when not owed.
 */
export async function digestWindow(key: string, now: Date): Promise<DigestWindow | null> {
	const day = clubToday(now);
	if (now < clubInstant(day, DIGEST_TIME)) return null;
	const [last] = await db
		.select({ day: reminderSent.subjectId, sentAt: reminderSent.sentAt })
		.from(reminderSent)
		.where(eq(reminderSent.reminderKey, key))
		.orderBy(desc(reminderSent.sentAt))
		.limit(1);
	if (last?.day === day) return null;
	return { day, since: last?.sentAt ?? new Date(now.getTime() - FIRST_LOOKBACK_MS) };
}

/** The day's latch row, for the caller's batch. `sentAt` is the next pass's `since`. */
export function dayStamp(key: string, window: DigestWindow, sentAt: Date) {
	return db.insert(reminderSent).values({
		reminderKey: key,
		subjectType: 'club_day',
		subjectId: window.day,
		sentAt
	});
}
