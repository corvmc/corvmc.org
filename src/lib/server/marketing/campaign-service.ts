import { db } from '$lib/server/db';
import {
	campaign,
	campaignAudience,
	audience,
	audienceMember,
	subscriber
} from '$lib/server/db/schema/marketing';
import { eq, and, sql, isNull, lte, inArray } from 'drizzle-orm';
import { isSystemAudienceKey, resolveSystemAudienceRecipients } from './system-audiences';
import { renderCampaignPreview, renderCampaignForSend } from './campaign-render';
import { signUnsubscribeToken } from './unsubscribe';
import { sendBroadcastBatch, type BroadcastMessage } from '$lib/server/notification/email';
import { env } from '$env/dynamic/private';
import { DomainError } from '$lib/server/domain-error';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The campaign does not exist. */
export class CampaignNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Campaign not found');
	}
}

/** The submitted campaign fields are out of range or incomplete. */
export class CampaignValidationError extends DomainError {
	readonly httpStatus = 400;

	constructor(message: string) {
		super(message);
	}
}

/** The campaign is not in a status that allows the requested operation. */
export class CampaignStateError extends DomainError {
	readonly httpStatus = 409;

	constructor(message: string) {
		super(message);
	}
}

// ---------------------------------------------------------------------------
// Campaign service
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Derived status helper
// ---------------------------------------------------------------------------

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent';

export function deriveCampaignStatus(
	scheduledFor: Date | null,
	sentAt: Date | null
): CampaignStatus {
	if (sentAt) return 'sent';
	if (!scheduledFor) return 'draft';
	if (scheduledFor > new Date()) return 'scheduled';
	return 'sending';
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createCampaign(data: {
	subject: string;
	markdownBody: string;
	audienceIds: string[];
	sentById: string;
}) {
	if (data.subject.length > 500) throw new CampaignValidationError('Subject too long (max 500)');
	if (data.audienceIds.length === 0)
		throw new CampaignValidationError('At least one audience is required');
	if (data.audienceIds.length > 20)
		throw new CampaignValidationError('Too many audiences (max 20)');

	const htmlBody = renderCampaignPreview(data.markdownBody);

	const [created] = await db
		.insert(campaign)
		.values({
			subject: data.subject,
			markdownBody: data.markdownBody,
			htmlBody,
			sentById: data.sentById
		})
		.returning();

	if (data.audienceIds.length > 0) {
		await db.insert(campaignAudience).values(
			data.audienceIds.map((audienceId) => ({
				campaignId: created.id,
				audienceId
			}))
		);
	}

	return created;
}

export async function updateCampaign(
	id: string,
	data: { subject?: string; markdownBody?: string; audienceIds?: string[] }
) {
	const existing = await getCampaignRaw(id);
	if (!existing) throw new CampaignNotFoundError();

	const status = deriveCampaignStatus(existing.scheduledFor, existing.sentAt);
	if (status !== 'draft') throw new CampaignStateError('Can only edit draft campaigns');

	if (data.subject !== undefined && data.subject.length > 500)
		throw new CampaignValidationError('Subject too long (max 500)');
	if (data.audienceIds !== undefined && data.audienceIds.length === 0)
		throw new CampaignValidationError('At least one audience is required');
	if (data.audienceIds !== undefined && data.audienceIds.length > 20)
		throw new CampaignValidationError('Too many audiences (max 20)');

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (data.subject !== undefined) updates.subject = data.subject;
	if (data.markdownBody !== undefined) {
		updates.markdownBody = data.markdownBody;
		updates.htmlBody = renderCampaignPreview(data.markdownBody);
	}

	const [updated] = await db.update(campaign).set(updates).where(eq(campaign.id, id)).returning();

	if (data.audienceIds !== undefined) {
		await db.delete(campaignAudience).where(eq(campaignAudience.campaignId, id));
		if (data.audienceIds.length > 0) {
			await db.insert(campaignAudience).values(
				data.audienceIds.map((audienceId) => ({
					campaignId: id,
					audienceId
				}))
			);
		}
	}

	return updated;
}

export async function deleteCampaign(id: string) {
	const existing = await getCampaignRaw(id);
	if (!existing) throw new CampaignNotFoundError();

	const status = deriveCampaignStatus(existing.scheduledFor, existing.sentAt);
	if (status !== 'draft') throw new CampaignStateError('Can only delete draft campaigns');

	await db.delete(campaign).where(eq(campaign.id, id));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function getCampaignRaw(id: string) {
	const [row] = await db.select().from(campaign).where(eq(campaign.id, id)).limit(1);
	return row ?? null;
}

export async function getCampaign(id: string) {
	const row = await db.query.campaign.findFirst({
		where: { id },
		with: {
			audiences: {
				with: { audience: { columns: { id: true, name: true } } }
			}
		}
	});

	if (!row) return null;

	return {
		...row,
		status: deriveCampaignStatus(row.scheduledFor, row.sentAt),
		audiences: row.audiences.filter((ca) => ca.audience).map((ca) => ca.audience!)
	};
}

export async function listCampaigns(statusFilter?: CampaignStatus) {
	const rows = await db.query.campaign.findMany({
		with: {
			audiences: {
				with: { audience: { columns: { name: true } } }
			}
		},
		columns: {
			id: true,
			subject: true,
			scheduledFor: true,
			sentAt: true,
			sentById: true,
			recipientCount: true,
			createdAt: true,
			updatedAt: true
		},
		orderBy: (c, { desc }) => [desc(sql`coalesce(${c.sentAt}, ${c.scheduledFor}, ${c.createdAt})`)]
	});

	const result = rows.map((r) => ({
		...r,
		status: deriveCampaignStatus(r.scheduledFor, r.sentAt),
		audienceNames: r.audiences.filter((ca) => ca.audience).map((ca) => ca.audience!.name)
	}));

	if (statusFilter) {
		return result.filter((r) => r.status === statusFilter);
	}

	return result;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export async function scheduleCampaign(id: string, scheduledFor: Date) {
	const existing = await getCampaignRaw(id);
	if (!existing) throw new CampaignNotFoundError();

	const status = deriveCampaignStatus(existing.scheduledFor, existing.sentAt);
	if (status !== 'draft') throw new CampaignStateError('Can only schedule draft campaigns');
	if (scheduledFor <= new Date())
		throw new CampaignValidationError('Scheduled time must be in the future');

	await db.update(campaign).set({ scheduledFor, updatedAt: new Date() }).where(eq(campaign.id, id));
}

export async function unscheduleCampaign(id: string) {
	const existing = await getCampaignRaw(id);
	if (!existing) throw new CampaignNotFoundError();

	const status = deriveCampaignStatus(existing.scheduledFor, existing.sentAt);
	if (status !== 'scheduled')
		throw new CampaignStateError('Can only unschedule scheduled campaigns');

	await db
		.update(campaign)
		.set({ scheduledFor: null, updatedAt: new Date() })
		.where(eq(campaign.id, id));
}

export async function sendNow(id: string) {
	const existing = await getCampaignRaw(id);
	if (!existing) throw new CampaignNotFoundError();

	const status = deriveCampaignStatus(existing.scheduledFor, existing.sentAt);
	if (status !== 'draft') throw new CampaignStateError('Can only send draft campaigns');

	// Set scheduledFor to now — executeSend picks it up
	await db
		.update(campaign)
		.set({ scheduledFor: new Date(), updatedAt: new Date() })
		.where(eq(campaign.id, id));

	// Execute inline rather than waiting for cron
	await executeSend(id);
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

export async function getRecipientsForCampaign(campaignId: string) {
	// Targeted audiences, with the marker that says how to resolve each one.
	const targeted = await db
		.select({ id: audience.id, systemKey: audience.systemKey })
		.from(campaignAudience)
		.innerJoin(audience, eq(audience.id, campaignAudience.audienceId))
		.where(eq(campaignAudience.campaignId, campaignId));

	if (targeted.length === 0) return [];

	// Sorted so the audience retained for a deduplicated recipient — which
	// scopes their unsubscribe token — doesn't depend on row order.
	const ordered = [...targeted].sort((a, b) => a.id.localeCompare(b.id));

	const staticIds = ordered.filter((a) => !isSystemAudienceKey(a.systemKey)).map((a) => a.id);
	const rows: {
		subscriberId: string;
		email: string;
		name: string | null;
		audienceId: string;
	}[] = [];

	if (staticIds.length > 0) {
		rows.push(
			...(await db
				.selectDistinct({
					subscriberId: subscriber.id,
					email: subscriber.email,
					name: subscriber.name,
					audienceId: audienceMember.audienceId
				})
				.from(audienceMember)
				.innerJoin(subscriber, eq(subscriber.id, audienceMember.subscriberId))
				.where(
					and(
						inArray(audienceMember.audienceId, staticIds),
						isNull(audienceMember.unsubscribedAt),
						isNull(subscriber.suppressedAt)
					)
				))
		);
	}

	for (const a of ordered) {
		if (!isSystemAudienceKey(a.systemKey)) continue;
		rows.push(...(await resolveSystemAudienceRecipients(a.id, a.systemKey)));
	}

	// One message per subscriber, however many of the targeted audiences they
	// are in. Built-in audiences overlap every static list, so without this a
	// member on "All Members" and the newsletter gets two copies.
	const rank = new Map(ordered.map((a, i) => [a.id, i]));
	const bySubscriber = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		const seen = bySubscriber.get(row.subscriberId);
		if (!seen || (rank.get(row.audienceId) ?? Infinity) < (rank.get(seen.audienceId) ?? Infinity)) {
			bySubscriber.set(row.subscriberId, row);
		}
	}

	return [...bySubscriber.values()];
}

// ---------------------------------------------------------------------------
// Send execution
// ---------------------------------------------------------------------------

/**
 * Execute the actual send for a campaign. Resolves recipients,
 * renders per-recipient emails, and sends via Postmark broadcast stream.
 */
export async function executeSend(campaignId: string): Promise<number> {
	const row = await getCampaignRaw(campaignId);
	if (!row) throw new CampaignNotFoundError();
	if (row.sentAt) throw new CampaignStateError('Campaign already sent');

	const recipients = await getRecipientsForCampaign(campaignId);
	if (recipients.length === 0) {
		// Mark as sent with 0 recipients
		await db
			.update(campaign)
			.set({ sentAt: new Date(), recipientCount: 0, updatedAt: new Date() })
			.where(eq(campaign.id, campaignId));
		return 0;
	}

	// PUBLIC_SITE_URL, not a marketing-only alias: unsubscribe links and the RFC
	// 8058 List-Unsubscribe header have to point at the environment actually
	// sending the mail, or a staging send hands recipients production links.
	const baseUrl = env.PUBLIC_SITE_URL ?? 'https://corvmc.org';

	const messages: BroadcastMessage[] = recipients.map((r) => {
		const unsubscribeUrl = `${baseUrl}/unsubscribe/${signUnsubscribeToken(r.subscriberId, r.audienceId)}`;
		const htmlBody = renderCampaignForSend(row.markdownBody, r.name, unsubscribeUrl);
		return {
			to: r.email,
			subject: row.subject,
			htmlBody,
			tag: 'campaign',
			metadata: { campaignId },
			// One-click unsubscribe (RFC 8058) — required for Gmail/Yahoo bulk
			// senders. The List-Unsubscribe-Post header makes mail clients POST
			// the same URL the footer link points at.
			headers: [
				{ Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` },
				{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
			]
		};
	});

	await sendBroadcastBatch(messages);

	await db
		.update(campaign)
		.set({
			sentAt: new Date(),
			recipientCount: recipients.length,
			updatedAt: new Date()
		})
		.where(eq(campaign.id, campaignId));

	return recipients.length;
}

// ---------------------------------------------------------------------------
// Cron: process due campaigns
// ---------------------------------------------------------------------------

/**
 * Find and send all campaigns that are due (scheduledFor <= now, sentAt is null).
 * Returns the number of campaigns processed.
 */
export async function processDueCampaigns(): Promise<number> {
	const due = await db
		.select({ id: campaign.id })
		.from(campaign)
		.where(and(lte(campaign.scheduledFor, new Date()), isNull(campaign.sentAt)));

	for (const row of due) {
		try {
			await executeSend(row.id);
		} catch (err) {
			console.error(`[campaign] Failed to send campaign ${row.id}:`, err);
		}
	}

	return due.length;
}

// ---------------------------------------------------------------------------
// Preview helper (for the editor)
// ---------------------------------------------------------------------------

export { renderCampaignPreview } from './campaign-render';
