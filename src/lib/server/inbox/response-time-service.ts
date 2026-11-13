import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { FIRST_RESPONSE_WINDOW_DAYS, staffInboxChannels } from '#lib/config.js';
import type { StaffInboxChannel } from '#lib/config.js';

export interface ChannelFirstResponse {
	channel: StaffInboxChannel;
	/** Median seconds from first inbound message to first outbound one; null with no replies. */
	medianSeconds: number | null;
	replied: number;
	/** Not resolved and never answered. Excluded from the median. */
	waiting: number;
}

/**
 * Time to first reply on the staff channels, derived from `inbox_message`.
 *
 * A thread counts when its first inbound message falls in the window. Its
 * reply is the first outbound message at or after that one; outbound covers
 * replies sent from the Meta apps, which have no author here. A resolved
 * thread with no reply is neither replied nor waiting.
 */
export async function firstResponseByChannel(
	now: Date = new Date()
): Promise<ChannelFirstResponse[]> {
	const since = Math.floor(now.getTime() / 1000) - FIRST_RESPONSE_WINDOW_DAYS * 86_400;
	const channels = sql.join(
		staffInboxChannels.map((c) => sql`${c}`),
		sql`, `
	);

	const rows = await db.all<{
		channel: StaffInboxChannel;
		median: number | null;
		replied: number;
		waiting: number;
	}>(sql`
		WITH firsts AS (
			SELECT t.id, t.channel, t.status,
				(SELECT min(m.created_at) FROM inbox_message m
				 WHERE m.thread_id = t.id AND m.direction = 'inbound') AS first_in
			FROM inbox_thread t
			WHERE t.channel IN (${channels})
		), paired AS (
			SELECT f.channel, f.status, f.first_in,
				(SELECT min(m.created_at) FROM inbox_message m
				 WHERE m.thread_id = f.id AND m.direction = 'outbound'
				   AND m.created_at >= f.first_in) AS first_out
			FROM firsts f
			WHERE f.first_in >= ${since}
		), ranked AS (
			SELECT channel, first_out - first_in AS secs,
				row_number() OVER (PARTITION BY channel ORDER BY first_out - first_in) AS rn,
				count(*) OVER (PARTITION BY channel) AS n
			FROM paired
			WHERE first_out IS NOT NULL
		)
		SELECT p.channel,
			(SELECT avg(r.secs) FROM ranked r
			 WHERE r.channel = p.channel AND r.rn IN ((r.n + 1) / 2, (r.n + 2) / 2)) AS median,
			sum(p.first_out IS NOT NULL) AS replied,
			sum(p.first_out IS NULL AND p.status <> 'resolved') AS waiting
		FROM paired p
		GROUP BY p.channel
	`);

	return rows
		.filter((r) => r.replied > 0 || r.waiting > 0)
		.map((r) => ({
			channel: r.channel,
			medianSeconds: r.median === null ? null : Math.round(r.median),
			replied: r.replied,
			waiting: r.waiting
		}))
		.sort((a, b) => staffInboxChannels.indexOf(a.channel) - staffInboxChannels.indexOf(b.channel));
}
