import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { audience, campaignSend } from '#lib/server/db/schema/marketing.js';
import type { CampaignSendStatus } from '#lib/types/marketing.js';

/**
 * What a Postmark event may change a send to, and from. A late delivery
 * corrects a soft bounce; nothing moves a complaint, the strongest signal.
 */
const MOVES_FROM: Record<'delivered' | 'bounced' | 'complained', CampaignSendStatus[]> = {
	delivered: ['sent', 'bounced'],
	bounced: ['sent', 'delivered'],
	complained: ['sent', 'delivered', 'bounced']
};

/** Apply one Postmark event to the campaign send it is about. False when none matches. */
export async function recordSendEvent(
	providerMessageId: string,
	status: keyof typeof MOVES_FROM
): Promise<boolean> {
	const updated = await db
		.update(campaignSend)
		.set({ status, updatedAt: new Date() })
		.where(
			and(
				eq(campaignSend.providerMessageId, providerMessageId),
				inArray(campaignSend.status, MOVES_FROM[status])
			)
		)
		.returning({ id: campaignSend.id });
	return updated.length > 0;
}

/** A sent campaign's recipients, problems first, with a count per status. */
export async function listCampaignSends(campaignId: string) {
	const [rows, totals] = await Promise.all([
		db
			.select({
				id: campaignSend.id,
				email: campaignSend.email,
				status: campaignSend.status,
				error: campaignSend.error,
				audience: audience.name
			})
			.from(campaignSend)
			.leftJoin(audience, eq(audience.id, campaignSend.audienceId))
			.where(eq(campaignSend.campaignId, campaignId))
			.orderBy(
				sql`case ${campaignSend.status} when 'failed' then 0 when 'bounced' then 1 when 'complained' then 2 else 3 end`,
				asc(campaignSend.email),
				asc(campaignSend.id)
			),
		db
			.select({ status: campaignSend.status, n: count() })
			.from(campaignSend)
			.where(eq(campaignSend.campaignId, campaignId))
			.groupBy(campaignSend.status)
	]);
	const counts: Partial<Record<CampaignSendStatus, number>> = {};
	for (const t of totals) counts[t.status] = t.n;
	return { rows, counts };
}
