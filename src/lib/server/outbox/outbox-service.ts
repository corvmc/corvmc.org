import { and, asc, desc, eq, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	outboxMessage,
	type OutboxMessage,
	type OutboxStatus
} from '#lib/server/db/schema/outbox.js';
import {
	sendHtmlEmails,
	sendTemplatedEmails,
	type HtmlEmail,
	type SendResult,
	type TemplatedEmail
} from '#lib/server/notification/email/postmark-client.js';
import { afterResponse } from '#lib/server/after-response.js';
import { captureException } from '#lib/server/sentry.js';
import { chunk, chunkInsert } from '#lib/server/utils/chunk.js';
import { emailRow, type OutboxSubject } from './outbox-row';

/** After this many failed sends a row is `failed` and nothing retries it. */
export const MAX_ATTEMPTS = 5;

/** 1, 4, 16 and 64 minutes: a Postmark outage of an hour still delivers. */
export function backoffMs(attempts: number): number {
	return 60_000 * 4 ** Math.max(0, attempts - 1);
}

/** Longer than any one send takes, so a sender that died mid-send frees its rows. */
const CLAIM_MS = 5 * 60_000;

/** Ids per `IN (...)`, under D1's 100 bound parameters with room for the rest of the query. */
const IDS_PER_STATEMENT = 80;

export interface Delivery {
	id: string;
	status: OutboxStatus;
	error: string | null;
}

/**
 * Record emails in the outbox and send them once the response has gone. For a
 * caller with no write of its own to batch with; one that has puts `emailRow`
 * values in its own `db.batch` and calls `deliverSoon`.
 */
export async function queueEmails(
	mails: TemplatedEmail[],
	subject?: OutboxSubject
): Promise<string[]> {
	if (mails.length === 0) return [];
	const rows = mails.map((m) => emailRow(m, subject));
	const inserts = chunkInsert(rows, (group) => db.insert(outboxMessage).values(group));
	await db.batch(inserts as [(typeof inserts)[number], ...typeof inserts]);
	const ids = rows.map((r) => r.id);
	await deliverSoon(ids);
	return ids;
}

export const queueEmail = (mail: TemplatedEmail, subject?: OutboxSubject) =>
	queueEmails([mail], subject);

/** Send these rows off the request path. Whatever fails here, the cron retries. */
export function deliverSoon(ids: string[]): Promise<void> {
	return afterResponse(() => deliverOutbox({ ids }), { channel: 'outbox', count: ids.length });
}

function due(now: Date) {
	return and(
		eq(outboxMessage.status, 'pending'),
		lte(outboxMessage.nextAttemptAt, now),
		or(isNull(outboxMessage.claimedUntil), lt(outboxMessage.claimedUntil, now))
	);
}

/** Take the due rows among `ids` for this sender. The update is the lock: two senders, one winner. */
async function claim(ids: string[], now: Date): Promise<OutboxMessage[]> {
	const claimed: OutboxMessage[] = [];
	for (const group of chunk(ids, IDS_PER_STATEMENT)) {
		claimed.push(
			...(await db
				.update(outboxMessage)
				.set({
					claimedUntil: new Date(now.getTime() + CLAIM_MS),
					attempts: sql`${outboxMessage.attempts} + 1`
				})
				.where(and(inArray(outboxMessage.id, group), due(now)))
				.returning())
		);
	}
	return claimed;
}

async function send(rows: OutboxMessage[]): Promise<Map<string, SendResult>> {
	const results = new Map<string, SendResult>();
	const emails = rows.filter((r) => r.kind === 'email');
	const sent = await sendTemplatedEmails(emails.map((r) => r.payload as unknown as TemplatedEmail));
	emails.forEach((r, i) => results.set(r.id, sent[i]));

	const rendered = rows.filter((r) => r.kind === 'html_email');
	const sentHtml = await sendHtmlEmails(rendered.map((r) => r.payload as unknown as HtmlEmail));
	rendered.forEach((r, i) => results.set(r.id, sentHtml[i]));

	const replies = rows.filter((row) => row.kind === 'inbox_reply');
	if (replies.length === 0) return results;
	// Loaded on demand: every notification sender imports this module, and none needs the inbox.
	const { deliverQueuedReply } = await import('#lib/server/inbox/message-service.js');
	for (const r of replies) {
		try {
			const id = await deliverQueuedReply(String(r.payload.messageId));
			results.set(r.id, { ok: true, messageId: id ?? '' });
		} catch (err) {
			results.set(r.id, { ok: false, error: err instanceof Error ? err.message : String(err) });
		}
	}
	return results;
}

/**
 * Send what is due: the rows named by `ids`, or else the oldest due rows. A
 * failure stays `pending` with its error and a later `next_attempt_at`, and
 * turns `failed` once it has had `MAX_ATTEMPTS`.
 */
export async function deliverOutbox(
	opts: { ids?: string[]; limit?: number; now?: Date } = {}
): Promise<Delivery[]> {
	const now = opts.now ?? new Date();
	const ids =
		opts.ids ??
		(
			await db
				.select({ id: outboxMessage.id })
				.from(outboxMessage)
				.where(due(now))
				.orderBy(asc(outboxMessage.nextAttemptAt))
				.limit(opts.limit ?? 200)
		).map((r) => r.id);
	if (ids.length === 0) return [];

	const rows = await claim(ids, now);
	if (rows.length === 0) return [];
	const results = await send(rows);

	const deliveries: Delivery[] = [];
	const updates = rows.map((row) => {
		const result = results.get(row.id) ?? { ok: false as const, error: 'Not sent' };
		if (result.ok) {
			deliveries.push({ id: row.id, status: 'sent', error: null });
			return db
				.update(outboxMessage)
				.set({
					status: 'sent',
					sentAt: now,
					providerMessageId: result.messageId || null,
					lastError: null,
					claimedUntil: null
				})
				.where(eq(outboxMessage.id, row.id));
		}
		const status = row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
		deliveries.push({ id: row.id, status, error: result.error });
		return db
			.update(outboxMessage)
			.set({
				status,
				lastError: result.error.slice(0, 1000),
				nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
				claimedUntil: null
			})
			.where(eq(outboxMessage.id, row.id));
	});
	await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
	return deliveries;
}

/**
 * Send one row now and say how it went, for an action whose answer depends on
 * it. Never throws: the write that owed the message has already committed, and
 * the cron retries whatever this could not send.
 */
export async function deliverNow(id: string): Promise<Delivery> {
	try {
		const [delivery] = await deliverOutbox({ ids: [id] });
		return delivery ?? (await deliveryOf(id));
	} catch (err) {
		captureException(err, { channel: 'outbox', id });
		return { id, status: 'pending', error: err instanceof Error ? err.message : String(err) };
	}
}

async function deliveryOf(id: string): Promise<Delivery> {
	const [row] = await db
		.select({ status: outboxMessage.status, error: outboxMessage.lastError })
		.from(outboxMessage)
		.where(eq(outboxMessage.id, id))
		.limit(1);
	return { id, status: row?.status ?? 'pending', error: row?.error ?? null };
}

/** The newest message owed for a record, for its page. Null when nothing was. */
export async function latestDelivery(subject: OutboxSubject) {
	const [row] = await db
		.select({
			id: outboxMessage.id,
			status: outboxMessage.status,
			lastError: outboxMessage.lastError,
			attempts: outboxMessage.attempts,
			sentAt: outboxMessage.sentAt,
			createdAt: outboxMessage.createdAt
		})
		.from(outboxMessage)
		.where(
			and(eq(outboxMessage.subjectType, subject.type), eq(outboxMessage.subjectId, subject.id))
		)
		.orderBy(desc(outboxMessage.createdAt), desc(outboxMessage.id))
		.limit(1);
	return row ?? null;
}

/** The newest message owed for each record of one type, by record id, for a list page. */
export async function latestDeliveries(
	type: string,
	ids: string[]
): Promise<Map<string, OutboxStatus>> {
	const out = new Map<string, OutboxStatus>();
	for (const group of chunk(ids, IDS_PER_STATEMENT)) {
		const rows = await db
			.select({ subjectId: outboxMessage.subjectId, status: outboxMessage.status })
			.from(outboxMessage)
			.where(and(eq(outboxMessage.subjectType, type), inArray(outboxMessage.subjectId, group)))
			.orderBy(desc(outboxMessage.createdAt), desc(outboxMessage.id));
		for (const r of rows) if (r.subjectId && !out.has(r.subjectId)) out.set(r.subjectId, r.status);
	}
	return out;
}

/**
 * Send a message that has not gone, now, with a fresh set of attempts: a
 * person asking again. Null when it has gone, or a sender holds it right now.
 */
export async function retryNow(id: string): Promise<Delivery | null> {
	const now = new Date();
	const reset = await db
		.update(outboxMessage)
		.set({ status: 'pending', attempts: 0, nextAttemptAt: now, lastError: null })
		.where(
			and(
				eq(outboxMessage.id, id),
				ne(outboxMessage.status, 'sent'),
				or(isNull(outboxMessage.claimedUntil), lt(outboxMessage.claimedUntil, now))
			)
		)
		.returning({ id: outboxMessage.id });
	if (reset.length === 0) return null;
	return deliverNow(id);
}
