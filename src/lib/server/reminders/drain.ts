import { db } from '#lib/server/db/index.js';
import { reminderSent } from '#lib/server/db/schema/reminder.js';
import { domainEvents, type DomainEvents } from '#lib/server/event-bus/event-bus.js';
import { captureException } from '#lib/server/sentry.js';
import { reminders } from './registry';
import { alreadySentFor } from './sent-marks';
import type { DigestDue, ReminderDefinition, ReminderDue, ReminderRecipient } from './types';

export interface DrainResult {
	due: number;
	sent: number;
	alreadySent: number;
	failed: number;
}

// After the emit, never before: a mark written first would swallow the
// reminder for good if the listener threw. The other order can repeat one,
// which is the cheaper mistake.
function markSent(definition: ReminderDefinition, subjectId: string) {
	return db.insert(reminderSent).values({
		reminderKey: definition.key,
		subjectType: definition.subjectType,
		subjectId
	});
}

/** What `due()` returned, less what this definition has already sent. */
async function owed<T extends { subjectId: string }>(
	definition: ReminderDefinition,
	now: Date,
	out: DrainResult
): Promise<T[]> {
	const due = (await definition.due(now)) as unknown as T[];
	out.due += due.length;
	if (due.length === 0) return [];
	const sent = await alreadySentFor(
		definition.key,
		due.map((d) => d.subjectId)
	);
	out.alreadySent += due.filter((d) => sent.has(d.subjectId)).length;
	return due.filter((d) => !sent.has(d.subjectId));
}

async function drainOne(definition: ReminderDefinition, now: Date, out: DrainResult) {
	for (const item of await owed<ReminderDue<keyof DomainEvents>>(definition, now, out)) {
		try {
			await domainEvents.emit(definition.event, item.payload);
			await markSent(definition, item.subjectId);
			out.sent++;
		} catch (err) {
			out.failed++;
			captureException(err, { event: definition.event, subjectId: item.subjectId });
		}
	}
}

type Pending = DigestDue<keyof DomainEvents> & { definition: ReminderDefinition };

/**
 * One emit per recipient for every digest item owed under one event. An item
 * is stamped only once every one of its recipients' emits went through; one
 * that failed leaves it owed, to be sent again to all of them next pass.
 */
async function sendDigests(event: keyof DomainEvents, pending: Pending[], out: DrainResult) {
	const byRecipient = new Map<string, { recipient: ReminderRecipient; items: unknown[] }>();
	for (const p of pending) {
		for (const recipient of p.recipients) {
			const entry = byRecipient.get(recipient.userId) ?? { recipient, items: [] };
			entry.items.push(p.item);
			byRecipient.set(recipient.userId, entry);
		}
	}

	const failedFor = new Set<string>();
	for (const [userId, digest] of byRecipient) {
		try {
			await domainEvents.emit(event, digest as DomainEvents[typeof event]);
		} catch (err) {
			failedFor.add(userId);
			captureException(err, { event, userId });
		}
	}

	for (const p of pending) {
		if (p.recipients.some((r) => failedFor.has(r.userId))) {
			out.failed++;
			continue;
		}
		try {
			await markSent(p.definition, p.subjectId);
			out.sent++;
		} catch (err) {
			out.failed++;
			captureException(err, { event, subjectId: p.subjectId });
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
	const digests = new Map<keyof DomainEvents, Pending[]>();

	for (const definition of definitions) {
		try {
			if (!definition.digest) {
				await drainOne(definition, now, out);
				continue;
			}
			const items = await owed<DigestDue<keyof DomainEvents>>(definition, now, out);
			const list = digests.get(definition.event) ?? [];
			list.push(...items.map((d) => ({ ...d, definition })));
			digests.set(definition.event, list);
		} catch (err) {
			out.failed++;
			captureException(err, { event: 'reminders.drain', reminderKey: definition.key });
		}
	}

	for (const [event, pending] of digests) await sendDigests(event, pending, out);

	return out;
}
