import { eq, inArray } from 'drizzle-orm';
import * as env from '$app/env/public';
import { db } from '#lib/server/db/index.js';
import { campaign, campaignSend, subscriber } from '#lib/server/db/schema/marketing.js';
import {
	sendBroadcastBatch,
	type BroadcastMessage,
	type SendResult
} from '#lib/server/notification/email/index.js';
import { contactEmail } from '#lib/server/site-config/site-config-service.js';
import { chunk } from '#lib/server/utils/chunk.js';
import { renderCampaignForSend } from './campaign-render';
import { creditedBody } from './campaign-service';
import { signUnsubscribeToken } from './unsubscribe';

/**
 * The outbox's transport for `campaign_email` rows: one recipient's copy of a
 * campaign, rendered here when it is sent and sent on Postmark's broadcast
 * stream through its batch endpoint, 500 to a call. The only module besides
 * the client that sends a broadcast; scripts/mail-outbox-guard.spec.ts keeps it so.
 */

/** Ids per `IN (...)`, under D1's 100 bound parameters. */
const IDS_PER_STATEMENT = 80;

/** Each `campaign_send` row's copy, answered in the order given. */
export async function deliverCampaignEmails(campaignSendIds: string[]): Promise<SendResult[]> {
	const sends = new Map<string, Recipient>();
	for (const group of chunk(campaignSendIds, IDS_PER_STATEMENT)) {
		const rows = await db
			.select({
				id: campaignSend.id,
				campaignId: campaignSend.campaignId,
				subscriberId: campaignSend.subscriberId,
				audienceId: campaignSend.audienceId,
				email: campaignSend.email,
				name: subscriber.name,
				suppressedAt: subscriber.suppressedAt
			})
			.from(campaignSend)
			.leftJoin(subscriber, eq(subscriber.id, campaignSend.subscriberId))
			.where(inArray(campaignSend.id, group));
		for (const r of rows) sends.set(r.id, r);
	}

	const renderers = new Map<string, ((r: Recipient) => BroadcastMessage) | null>();
	for (const campaignId of new Set([...sends.values()].map((s) => s.campaignId))) {
		renderers.set(campaignId, await rendererFor(campaignId));
	}

	const results: (SendResult | null)[] = [];
	const messages: BroadcastMessage[] = [];
	const slots: number[] = [];
	for (const id of campaignSendIds) {
		const send = sends.get(id);
		const render = send && renderers.get(send.campaignId);
		if (!send?.subscriberId || !render) {
			results.push({ ok: false, error: 'Campaign or subscriber no longer exists' });
			continue;
		}
		// Queued rows can wait for a later run; an address that bounced or
		// complained in the meantime is not mailed again.
		if (send.suppressedAt) {
			results.push({ ok: false, error: 'Suppressed since the campaign was sent' });
			continue;
		}
		slots.push(results.length);
		results.push(null);
		messages.push(render(send));
	}

	const sent = messages.length > 0 ? await sendBroadcastBatch(messages) : [];
	slots.forEach((slot, i) => (results[slot] = sent[i] ?? { ok: false, error: 'No response' }));
	return results as SendResult[];
}

type Recipient = {
	id: string;
	campaignId: string;
	subscriberId: string | null;
	audienceId: string | null;
	email: string;
	name: string | null;
	suppressedAt: Date | null;
};

/** One campaign's message builder: its body, credit and contact read once. */
async function rendererFor(campaignId: string) {
	const [row] = await db
		.select({
			subject: campaign.subject,
			markdownBody: campaign.markdownBody,
			eventId: campaign.eventId
		})
		.from(campaign)
		.where(eq(campaign.id, campaignId))
		.limit(1);
	if (!row) return null;

	// PUBLIC_SITE_URL, not a marketing-only alias: unsubscribe links and the RFC
	// 8058 List-Unsubscribe header have to point at the environment actually
	// sending the mail, or a staging send hands recipients production links.
	const baseUrl = env.PUBLIC_SITE_URL ?? 'https://corvmc.org';
	const markdown = await creditedBody(row.markdownBody, row.eventId);
	const contact = await contactEmail();

	return (r: Recipient): BroadcastMessage => {
		const unsubscribeUrl = `${baseUrl}/unsubscribe/${signUnsubscribeToken(r.subscriberId ?? '', r.audienceId ?? '')}`;
		return {
			to: r.email,
			subject: row.subject,
			htmlBody: renderCampaignForSend(markdown, r.name, unsubscribeUrl, contact),
			tag: 'campaign',
			// The send id lets the event webhook find this row (#2971).
			metadata: { campaignId, campaignSendId: r.id },
			// One-click unsubscribe (RFC 8058) — required for Gmail/Yahoo bulk
			// senders. The List-Unsubscribe-Post header makes mail clients POST
			// the same URL the footer link points at.
			headers: [
				{ Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` },
				{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
			]
		};
	};
}
