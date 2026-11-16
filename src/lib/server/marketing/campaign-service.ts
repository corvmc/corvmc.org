import { db } from '#lib/server/db/index.js';
import {
	campaign,
	campaignAudience,
	audience,
	audienceMember,
	campaignSend,
	subscriber
} from '#lib/server/db/schema/marketing.js';
import { eq, and, sql, isNull, lte, inArray, desc } from 'drizzle-orm';
import {
	isSystemAudienceKey,
	resolveSystemAudienceRecipients,
	skipReason
} from './system-audiences';
import type { RecipientSkip } from '#lib/types/marketing.js';
import { renderCampaignPreview, renderCampaignForSend } from './campaign-render';
import { contactEmail } from '#lib/server/site-config/site-config-service.js';
import { creditsForEvent } from '#lib/server/sponsor/credit-service.js';
import { withSponsorCredit } from '#lib/utils/sponsor-credit.js';
import { chunk, chunkInsert } from '#lib/server/utils/chunk.js';
import * as env from '$app/env/public';
import { DomainError } from '#lib/server/domain-error.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { formatDateShortYear } from '#lib/utils/format.js';
import { audiencesBeyondVisibility } from '#lib/utils/audience-reach.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { outboxMessage } from '#lib/server/db/schema/outbox.js';
import { htmlEmailRow, outboxRow } from '#lib/server/outbox/outbox-row.js';
import { deliverDueSoon, deliverNow, type Delivery } from '#lib/server/outbox/outbox-service.js';

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

/**
 * The body with a credit for the show's sponsors (#583), read when it renders:
 * a placement added after drafting still reaches the send.
 */
export async function creditedBody(markdown: string, eventId: string | null | undefined) {
	if (!eventId) return markdown;
	return withSponsorCredit(markdown, await creditsForEvent(eventId, 'campaign'));
}

export async function createCampaign(data: {
	subject: string;
	markdownBody: string;
	audienceIds: string[];
	sentById: string;
	/** The show this blast is about, which is what `event-interest` resolves. */
	eventId?: string | null;
}) {
	if (data.subject.length > 500) throw new CampaignValidationError('Subject too long (max 500)');
	if (data.audienceIds.length === 0)
		throw new CampaignValidationError('At least one audience is required');
	if (data.audienceIds.length > 20)
		throw new CampaignValidationError('Too many audiences (max 20)');

	const htmlBody = renderCampaignPreview(
		await creditedBody(data.markdownBody, data.eventId),
		await contactEmail()
	);

	const [created] = await db
		.insert(campaign)
		.values({
			subject: data.subject,
			markdownBody: data.markdownBody,
			htmlBody,
			eventId: data.eventId ?? null,
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
	data: {
		subject?: string;
		markdownBody?: string;
		audienceIds?: string[];
		/** Null clears the scope; absent leaves it alone. */
		eventId?: string | null;
	}
) {
	const existing = await getCampaignRaw(id);
	if (!existing) throw new CampaignNotFoundError();

	const status = deriveCampaignStatus(existing.scheduledFor, existing.sentAt);
	// Kept as a refusal, as in `sendNow`: unscheduling is the reversal.
	if (status !== 'draft') throw new CampaignStateError('Can only edit draft campaigns');

	if (data.subject !== undefined && data.subject.length > 500)
		throw new CampaignValidationError('Subject too long (max 500)');
	if (data.audienceIds !== undefined && data.audienceIds.length === 0)
		throw new CampaignValidationError('At least one audience is required');
	if (data.audienceIds !== undefined && data.audienceIds.length > 20)
		throw new CampaignValidationError('Too many audiences (max 20)');

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (data.subject !== undefined) updates.subject = data.subject;
	if (data.markdownBody !== undefined) updates.markdownBody = data.markdownBody;
	if (data.eventId !== undefined) updates.eventId = data.eventId;
	if (data.markdownBody !== undefined || data.eventId !== undefined) {
		updates.htmlBody = renderCampaignPreview(
			await creditedBody(
				data.markdownBody ?? existing.markdownBody,
				data.eventId !== undefined ? data.eventId : existing.eventId
			),
			await contactEmail()
		);
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

	// The show this blast is about, named rather than left as an id, so the
	// editor can show what it is scoped to without a second lookup (#857).
	const [scopedEvent] = row.eventId
		? await db
				.select({
					id: eventListing.id,
					title: eventListing.title,
					startsAt: eventListing.startsAt,
					visibility: eventListing.visibility
				})
				.from(eventListing)
				.where(eq(eventListing.id, row.eventId))
				.limit(1)
		: [];

	return {
		...row,
		status: deriveCampaignStatus(row.scheduledFor, row.sentAt),
		audiences: row.audiences.filter((ca) => ca.audience).map((ca) => ca.audience!),
		event: scopedEvent
			? {
					id: scopedEvent.id,
					title: scopedEvent.title,
					when: formatDateShortYear(scopedEvent.startsAt),
					visibility: scopedEvent.visibility
				}
			: null
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

/** The campaigns about one show, newest first, for its event page (#2776). */
export async function listCampaignsForEvent(eventId: string) {
	const rows = await db
		.select({
			id: campaign.id,
			subject: campaign.subject,
			scheduledFor: campaign.scheduledFor,
			sentAt: campaign.sentAt,
			recipientCount: campaign.recipientCount,
			createdAt: campaign.createdAt
		})
		.from(campaign)
		.where(eq(campaign.eventId, eventId))
		.orderBy(
			desc(sql`coalesce(${campaign.sentAt}, ${campaign.scheduledFor}, ${campaign.createdAt})`)
		);
	return rows.map((r) => ({ ...r, status: deriveCampaignStatus(r.scheduledFor, r.sentAt) }));
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
	await recordBeyondVisibility(id, true);
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
	// Kept as a refusal (docs/development/conventions.md#workflow-gates): a scheduled
	// campaign belongs to the cron sender, and unscheduling is the reversal.
	if (status !== 'draft') throw new CampaignStateError('Can only send draft campaigns');

	// Set scheduledFor to now — executeSend picks it up
	await db
		.update(campaign)
		.set({ scheduledFor: new Date(), updatedAt: new Date() })
		.where(eq(campaign.id, id));

	await recordBeyondVisibility(id, false);
	// Execute inline rather than waiting for cron
	await executeSend(id);
}

/**
 * Warn, record, allow (#2773): a blast about a members-only or group event may
 * go to audiences that reach past it, and the event's history says who sent it.
 */
async function recordBeyondVisibility(campaignId: string, scheduled: boolean) {
	const [row] = await db
		.select({
			subject: campaign.subject,
			eventId: eventListing.id,
			title: eventListing.title,
			visibility: eventListing.visibility
		})
		.from(campaign)
		.innerJoin(eventListing, eq(eventListing.id, campaign.eventId))
		.where(eq(campaign.id, campaignId))
		.limit(1);
	if (!row || row.visibility === 'public') return;

	const targeted = await db
		.select({ name: audience.name, systemKey: audience.systemKey, allowOptIn: audience.allowOptIn })
		.from(campaignAudience)
		.innerJoin(audience, eq(audience.id, campaignAudience.audienceId))
		.where(eq(campaignAudience.campaignId, campaignId));
	const beyond = audiencesBeyondVisibility(row.visibility, targeted);
	if (beyond.length === 0) return;

	await recordAuditEntry({
		action: 'event.emailed_beyond_visibility',
		subject: { type: 'event', id: row.eventId, label: row.title },
		details: {
			campaignId,
			subject: row.subject,
			visibility: row.visibility,
			audiences: beyond.map((a) => a.name),
			scheduled
		}
	});
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

type ResolvedRecipient = {
	subscriberId: string;
	email: string;
	name: string | null;
	audienceId: string;
};

/**
 * Who a campaign goes to, and the audience members it leaves out with the
 * reason (#2914). A subscriber deliverable through any targeted audience is a
 * recipient; one who is not is skipped once, under their first audience.
 */
export async function getRecipientsForCampaign(campaignId: string): Promise<{
	recipients: ResolvedRecipient[];
	skipped: (ResolvedRecipient & { skip: RecipientSkip })[];
}> {
	// The show this blast is about, if it is about one. Only `event-interest`
	// reads it, and without it that audience resolves to nobody (#857).
	const [scoped] = await db
		.select({ eventId: campaign.eventId })
		.from(campaign)
		.where(eq(campaign.id, campaignId))
		.limit(1);
	const eventId = scoped?.eventId ?? null;

	// Targeted audiences, with the marker that says how to resolve each one.
	const targeted = await db
		.select({ id: audience.id, systemKey: audience.systemKey })
		.from(campaignAudience)
		.innerJoin(audience, eq(audience.id, campaignAudience.audienceId))
		.where(eq(campaignAudience.campaignId, campaignId));

	if (targeted.length === 0) return { recipients: [], skipped: [] };

	// Sorted so the audience retained for a deduplicated recipient — which
	// scopes their unsubscribe token — doesn't depend on row order.
	const ordered = [...targeted].sort((a, b) => a.id.localeCompare(b.id));

	const staticIds = ordered.filter((a) => !isSystemAudienceKey(a.systemKey)).map((a) => a.id);
	const rows: (ResolvedRecipient & { skip: RecipientSkip | null })[] = [];

	if (staticIds.length > 0) {
		const members = await db
			.selectDistinct({
				subscriberId: subscriber.id,
				email: subscriber.email,
				name: subscriber.name,
				audienceId: audienceMember.audienceId,
				suppressedAt: subscriber.suppressedAt,
				unsubscribedAt: audienceMember.unsubscribedAt
			})
			.from(audienceMember)
			.innerJoin(subscriber, eq(subscriber.id, audienceMember.subscriberId))
			.where(inArray(audienceMember.audienceId, staticIds));
		for (const { suppressedAt, unsubscribedAt, ...m } of members) {
			rows.push({ ...m, skip: skipReason({ suppressedAt, optedOut: unsubscribedAt !== null }) });
		}
	}

	for (const a of ordered) {
		if (!isSystemAudienceKey(a.systemKey)) continue;
		rows.push(...(await resolveSystemAudienceRecipients(a.id, a.systemKey, eventId)));
	}

	// One message per subscriber, however many of the targeted audiences they
	// are in. Built-in audiences overlap every static list, so without this a
	// member on "All Members" and the newsletter gets two copies. A deliverable
	// row beats a skipped one; between equals, the first audience wins.
	const rank = new Map(ordered.map((a, i) => [a.id, i]));
	const order = (r: (typeof rows)[number]) =>
		(r.skip ? ordered.length : 0) + (rank.get(r.audienceId) ?? ordered.length);
	const bySubscriber = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		const seen = bySubscriber.get(row.subscriberId);
		if (!seen || order(row) < order(seen)) bySubscriber.set(row.subscriberId, row);
	}

	const recipients: ResolvedRecipient[] = [];
	const skipped: (ResolvedRecipient & { skip: RecipientSkip })[] = [];
	for (const { skip, ...r } of bySubscriber.values()) {
		if (skip) skipped.push({ ...r, skip });
		else recipients.push(r);
	}
	return { recipients, skipped };
}

// ---------------------------------------------------------------------------
// Send execution
// ---------------------------------------------------------------------------

/**
 * Recipients written per `db.batch`: about 22 statements, each one recipient's
 * `campaign_send` row and its outbox row written together, so a large audience
 * is many small batches rather than one D1 has to hold at once.
 */
const RECIPIENTS_PER_BATCH = 250;

/** One Postmark broadcast call's worth, sent as soon as the send is queued. */
const FIRST_DELIVERY = 500;

/**
 * Send a campaign: claim it, then queue one `campaign_send` row and one
 * outbox row per recipient (#2971). The outbox renders and sends them on the
 * broadcast stream, the first 500 at once and the rest from the cron, 200 a
 * run, so no single invocation renders or sends the whole audience.
 */
export async function executeSend(campaignId: string): Promise<number> {
	const row = await getCampaignRaw(campaignId);
	if (!row) throw new CampaignNotFoundError();
	if (row.sentAt) throw new CampaignStateError('Campaign already sent');

	const { recipients, skipped } = await getRecipientsForCampaign(campaignId);

	// Claimed before anything is queued, and only once: a second cron tick or a
	// Send now racing the cron finds it taken. At-most-once is the right trade
	// for a broadcast (#988).
	const claimed = await db
		.update(campaign)
		.set({ sentAt: new Date(), recipientCount: recipients.length, updatedAt: new Date() })
		.where(and(eq(campaign.id, campaignId), isNull(campaign.sentAt)))
		.returning({ id: campaign.id });
	if (claimed.length === 0) throw new CampaignStateError('Campaign already sent');

	await queueSends(campaignId, recipients, skipped);
	if (recipients.length > 0) await deliverDueSoon(FIRST_DELIVERY);
	return recipients.length;
}

/**
 * One `campaign_send` row per recipient, so the campaign page can say who it
 * went to and what happened (#2777), and one per member left out, with why
 * (#2914). A recipient's row is `pending` and its outbox row, filed under it,
 * holds whether it was sent; `listCampaignSends` reads the two together.
 */
async function queueSends(
	campaignId: string,
	recipients: { subscriberId: string; audienceId: string; email: string }[],
	skipped: { subscriberId: string; audienceId: string; email: string; skip: RecipientSkip }[]
): Promise<void> {
	const now = new Date();
	for (const group of chunk(recipients, RECIPIENTS_PER_BATCH)) {
		const sends = group.map((r) => ({
			id: crypto.randomUUID(),
			campaignId,
			subscriberId: r.subscriberId,
			audienceId: r.audienceId,
			email: r.email,
			status: 'pending' as const
		}));
		const outbox = sends.map((s) => ({
			...outboxRow(
				{ kind: 'campaign_email', payload: { campaignSendId: s.id } },
				{ type: 'campaign_send', id: s.id }
			),
			nextAttemptAt: now,
			createdAt: now
		}));
		const statements = [
			...chunkInsert(sends, (rows) => db.insert(campaignSend).values(rows)),
			...chunkInsert(outbox, (rows) => db.insert(outboxMessage).values(rows))
		];
		await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
	}

	const left = skipped.map((r) => ({
		campaignId,
		subscriberId: r.subscriberId,
		audienceId: r.audienceId,
		email: r.email,
		status:
			r.skip === 'suppressed' ? ('skipped_suppressed' as const) : ('skipped_unsubscribed' as const)
	}));
	const inserts = chunkInsert(left, (rows) => db.insert(campaignSend).values(rows));
	if (inserts.length > 0) await db.batch(inserts as [(typeof inserts)[number], ...typeof inserts]);
}

// ---------------------------------------------------------------------------
// Test send
// ---------------------------------------------------------------------------

/**
 * One copy of the stored campaign to the staffer sending it (#2771), as a
 * recipient would get it: their name in `{{subscriber_name}}`, sponsor credit
 * included. The unsubscribe link goes to the invalid-link page, so following
 * it from the test unsubscribes nobody. Goes through the outbox; a refused
 * send is answered, and the cron retries it.
 */
export async function sendTestCopy(
	campaignId: string,
	to: { email: string; name: string | null }
): Promise<Delivery> {
	const row = await getCampaignRaw(campaignId);
	if (!row) throw new CampaignNotFoundError();

	const baseUrl = env.PUBLIC_SITE_URL ?? 'https://corvmc.org';
	const htmlBody = renderCampaignForSend(
		await creditedBody(row.markdownBody, row.eventId),
		to.name,
		`${baseUrl}/unsubscribe/test`,
		await contactEmail()
	);
	const mail = htmlEmailRow(
		{ to: to.email, subject: `[Test] ${row.subject}`, htmlBody, tag: 'campaign-test' },
		{ type: 'campaign', id: campaignId }
	);
	await db.insert(outboxMessage).values(mail);
	return deliverNow(mail.id);
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
