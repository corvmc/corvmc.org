import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { outboxMessage, type OutboxStatus } from '#lib/server/db/schema/outbox.js';
import { chunk } from '#lib/server/utils/chunk.js';

export interface ReplyDelivery {
	outboxId: string;
	status: OutboxStatus;
	error: string | null;
}

/**
 * Each reply's newest outbox row, by message id, whatever record the row was
 * filed under: a market decision files its reply under the vendor. A message
 * with no row was sent before replies went through the outbox, or is an echo.
 */
export async function replyDeliveries(messageIds: string[]): Promise<Map<string, ReplyDelivery>> {
	const out = new Map<string, ReplyDelivery>();
	const messageId = sql<string>`json_extract(${outboxMessage.payload}, '$.messageId')`;
	for (const group of chunk(messageIds, 80)) {
		const rows = await db
			.select({
				messageId,
				outboxId: outboxMessage.id,
				status: outboxMessage.status,
				error: outboxMessage.lastError
			})
			.from(outboxMessage)
			.where(and(eq(outboxMessage.kind, 'inbox_reply'), inArray(messageId, group)))
			.orderBy(desc(outboxMessage.createdAt), desc(outboxMessage.id));
		for (const { messageId: id, ...delivery } of rows) if (!out.has(id)) out.set(id, delivery);
	}
	return out;
}

/**
 * Messages with how each reply went: `delivery` is null once it has gone, and
 * set while its outbox row is pending or failed, so the thread can show it.
 */
export async function withDelivery<T extends { id: string; direction: string }>(
	messages: T[]
): Promise<(T & { delivery: Omit<ReplyDelivery, 'outboxId'> | null })[]> {
	const outbound = messages.filter((m) => m.direction === 'outbound').map((m) => m.id);
	const deliveries = outbound.length > 0 ? await replyDeliveries(outbound) : new Map();
	return messages.map((m) => {
		const d = deliveries.get(m.id);
		return {
			...m,
			delivery: d && d.status !== 'sent' ? { status: d.status, error: d.error } : null
		};
	});
}
