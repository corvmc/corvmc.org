import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { audience, campaignSend } from '#lib/server/db/schema/marketing.js';
import { outboxMessage } from '#lib/server/db/schema/outbox.js';
import type { CampaignSendStatus } from '#lib/types/marketing.js';

/**
 * What a Postmark event may change a send to, and from. A late delivery
 * corrects a soft bounce; nothing moves a complaint, the strongest signal.
 * `pending` is a send queued on the outbox, which the event says was sent.
 */
const MOVES_FROM: Record<'delivered' | 'bounced' | 'complained', CampaignSendStatus[]> = {
	delivered: ['pending', 'sent', 'bounced'],
	bounced: ['pending', 'sent', 'delivered'],
	complained: ['pending', 'sent', 'delivered', 'bounced']
};

/**
 * Apply one Postmark event to the campaign send it is about. False when none
 * matches. A send queued on the outbox is named by the id in the message's
 * metadata; an older one by Postmark's MessageID.
 */
export async function recordSendEvent(
	providerMessageId: string,
	status: keyof typeof MOVES_FROM,
	campaignSendId?: string | null
): Promise<boolean> {
	const updated = await db
		.update(campaignSend)
		.set({ status, updatedAt: new Date() })
		.where(
			and(
				campaignSendId
					? or(
							eq(campaignSend.id, campaignSendId),
							eq(campaignSend.providerMessageId, providerMessageId)
						)
					: eq(campaignSend.providerMessageId, providerMessageId),
				inArray(campaignSend.status, MOVES_FROM[status])
			)
		)
		.returning({ id: campaignSend.id });
	return updated.length > 0;
}

/** The outbox row a queued send was filed with. */
const queuedAs = and(
	eq(outboxMessage.subjectType, 'campaign_send'),
	eq(outboxMessage.subjectId, campaignSend.id)
);

/** A queued send reads as its outbox row: pending, sent, or failed for good. */
const shownStatus = sql<CampaignSendStatus>`case when ${campaignSend.status} = 'pending'
	then coalesce(case ${outboxMessage.status} when 'sent' then 'sent' when 'failed' then 'failed' end, 'pending')
	else ${campaignSend.status} end`;

/** A sent campaign's recipients, problems first, with a count per status. */
export async function listCampaignSends(campaignId: string) {
	const [rows, totals] = await Promise.all([
		db
			.select({
				id: campaignSend.id,
				email: campaignSend.email,
				status: shownStatus,
				error: sql<string | null>`coalesce(${campaignSend.error}, ${outboxMessage.lastError})`,
				audience: audience.name
			})
			.from(campaignSend)
			.leftJoin(audience, eq(audience.id, campaignSend.audienceId))
			.leftJoin(outboxMessage, queuedAs)
			.where(eq(campaignSend.campaignId, campaignId))
			.orderBy(
				sql`case ${shownStatus} when 'failed' then 0 when 'bounced' then 1 when 'complained' then 2 when 'skipped_suppressed' then 4 when 'skipped_unsubscribed' then 4 else 3 end`,
				asc(campaignSend.email),
				asc(campaignSend.id)
			),
		db
			.select({ status: shownStatus, n: count() })
			.from(campaignSend)
			.leftJoin(outboxMessage, queuedAs)
			.where(eq(campaignSend.campaignId, campaignId))
			.groupBy(shownStatus)
	]);
	const counts: Partial<Record<CampaignSendStatus, number>> = {};
	for (const t of totals) counts[t.status] = t.n;
	return { rows, counts };
}
