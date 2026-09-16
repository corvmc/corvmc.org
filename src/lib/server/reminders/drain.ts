import { db } from '$lib/server/db';
import { reminderSent } from '$lib/server/db/schema/reminder';
import { and, eq, inArray } from 'drizzle-orm';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
import { reminders } from './registry';
import type { ReminderDefinition } from './types';

export interface DrainResult {
	due: number;
	sent: number;
	alreadySent: number;
	failed: number;
}

/**
 * Which of these subjects this reminder has already been sent for.
 *
 * Chunked: D1 caps a statement at 100 bound parameters, and a busy Saturday
 * can put more reservations than that inside one window.
 */
async function alreadySentFor(key: string, subjectIds: string[]): Promise<Set<string>> {
	const seen = new Set<string>();
	for (let i = 0; i < subjectIds.length; i += 90) {
		const rows = await db
			.select({ subjectId: reminderSent.subjectId })
			.from(reminderSent)
			.where(
				and(
					eq(reminderSent.reminderKey, key),
					inArray(reminderSent.subjectId, subjectIds.slice(i, i + 90))
				)
			);
		for (const row of rows) seen.add(row.subjectId);
	}
	return seen;
}

async function drainOne(definition: ReminderDefinition, now: Date, out: DrainResult) {
	const due = await definition.due(now);
	out.due += due.length;
	if (due.length === 0) return;

	const sent = await alreadySentFor(
		definition.key,
		due.map((d) => d.subjectId)
	);

	for (const item of due) {
		if (sent.has(item.subjectId)) {
			out.alreadySent++;
			continue;
		}
		try {
			await domainEvents.emit(definition.event, item.payload);
			// After the emit, never before: a mark written first would swallow the
			// reminder for good if the listener threw. The other order can repeat
			// one, which is the cheaper mistake.
			await db.insert(reminderSent).values({
				reminderKey: definition.key,
				subjectType: definition.subjectType,
				subjectId: item.subjectId
			});
			out.sent++;
		} catch (err) {
			out.failed++;
			captureException(err, { event: definition.event, subjectId: item.subjectId });
		}
	}
}

/**
 * Send whatever is owed, once.
 *
 * One pass over the registry. A definition that throws does not stop the
 * others: a reminder nobody gets is bad, and all of them missing because one
 * query broke is worse.
 */
export async function drainReminders(
	now: Date = new Date(),
	definitions: ReminderDefinition[] = reminders
): Promise<DrainResult> {
	const out: DrainResult = { due: 0, sent: 0, alreadySent: 0, failed: 0 };

	for (const definition of definitions) {
		try {
			await drainOne(definition, now, out);
		} catch (err) {
			out.failed++;
			captureException(err, { event: 'reminders.drain', reminderKey: definition.key });
		}
	}

	return out;
}
