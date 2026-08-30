import { db } from '$lib/server/db';
import { notification } from '$lib/server/db/schema/notification';
import { normalizeNotificationModel } from '$lib/server/notification/email/normalize-model';
import { sendTemplateBatch } from '$lib/server/notification/email';
import { pushToUser } from '$lib/server/notification/sse';
import { captureException } from '$lib/server/sentry';
import { groupKindLabels } from '$lib/config';
import type { NotificationEmailModel } from '$lib/types/notification-email';
import type { AnnouncementPublishedEvent } from '$lib/server/event-bus/event-bus';
import {
	claimForNotification,
	listRecipients,
	recordRecipientCount,
	type AnnouncementRecipient
} from './announcement-service';

/**
 * Fanning a published announcement out to a roster.
 *
 * Its own module rather than another block in `notification-listeners.ts`,
 * because it is the one notification in the app that is not one dispatch per
 * event. `dispatch()` in a loop performs, per recipient, a preference SELECT, a
 * notification INSERT, an in-memory SSE push and one outbound HTTPS call, all
 * awaited serially — roughly 600 sequential subrequests for a 200-member group
 * against a Worker's 1000-subrequest ceiling, tens of seconds of wall clock,
 * and a mid-loop failure that leaves half a group notified with no record of
 * where it stopped.
 *
 * This does the same work in one recipient query, ~20 statements across a
 * couple of `db.batch` calls, and one Postmark subrequest.
 */

/** The generic, model-driven Postmark template. No new template is needed. */
const GENERIC_ALIAS = 'notification';

/**
 * D1 caps a statement at 100 bound params. A notification row binds seven
 * columns, so 12 rows is 84 — comfortable headroom, and a naive 200-row insert
 * would be rejected outright rather than truncated.
 */
const NOTIFICATION_INSERT_CHUNK = 12;

/** Postmark's own per-call limit, which `sendTemplateBatch` also chunks on. */
const EMAIL_BATCH_SIZE = 500;

/**
 * The size at which this stops being the right shape.
 *
 * Real CMC groups are far below it. The ceiling is stated rather than
 * discovered: past this the send should persist a cursor and let a cron drain
 * it, so the failure mode at unexpected scale is a slow send rather than a
 * truncated one. Until that exists, the count is logged — a silent cap reads as
 * "covered everyone" when it did not.
 */
const LARGE_GROUP_THRESHOLD = 500;

/** Enough of the post to be worth opening, without pasting the whole thing. */
const EXCERPT_MAX = 400;

function excerpt(body: string): string {
	const flat = body
		// Markdown, flattened rather than rendered: this lands in a plain-text
		// paragraph and in an in-app notification body, neither of which parses it.
		.replace(/[#*_`>]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : flat;
}

/**
 * Where a member reads this group's announcements, which differs by kind: a
 * band has a panel, a club has a page with tabs.
 */
export function announcementsHref(kind: string, slug: string): string {
	return kind === 'band' ? `/band/${slug}/announcements` : `/member/groups/${slug}`;
}

function emailModel(
	event: AnnouncementPublishedEvent,
	recipient: AnnouncementRecipient,
	siteUrl: string
): Record<string, unknown> {
	const kind = groupKindLabels[event.groupKind];
	const href = announcementsHref(event.groupKind, event.groupSlug);
	const model: NotificationEmailModel = {
		subject: `${event.groupName}: ${event.title}`,
		heading: event.title,
		greeting: `Hi ${recipient.name.split(' ')[0]},`,
		paragraphs: [{ text: `${event.authorName} posted to the ${kind} ${event.groupName}.` }],
		// The post itself, escaped by `normalizeNotificationModel` because it is
		// the field carrying member-written text.
		quote: excerpt(event.body),
		cta: { url: `${siteUrl}${href}`, label: `Open ${event.groupName}` },
		// The mute link, and it is not optional decoration.
		//
		// These go out on the **transactional** stream, so they are not filtered by
		// the marketing suppression ledger — which is deliberate (you joined the
		// roster) and is also exactly the arrangement that earns a spam complaint.
		// A complaint there is far more damaging than one on broadcast, because
		// that stream also carries password resets. "There is a setting somewhere"
		// is what makes people press the spam button instead, so every one of these
		// carries a link that lands on the control.
		footnote: `Don't want these? Mute ${event.groupName} at ${siteUrl}${href}`
	};
	return normalizeNotificationModel(model);
}

/**
 * Notify a group that one of its announcements was published.
 *
 * Latches first and returns quietly if another invocation already claimed the
 * send. Everything after the latch is best-effort per channel: a failed email
 * batch must not prevent the in-app rows that already landed from being counted.
 */
export async function fanOutAnnouncement(
	event: AnnouncementPublishedEvent,
	siteUrl: string
): Promise<void> {
	// 1. Claim it. The bus delivers at least once, and a roster emailed twice is
	//    the failure this exists to prevent.
	if (!(await claimForNotification(event.announcementId))) return;

	// 2. One query for everyone who should hear it, with the author, the muted
	//    and the deactivated already excluded.
	const recipients = await listRecipients(event.groupId, event.authorId);
	if (recipients.length === 0) {
		await recordRecipientCount(event.announcementId, 0);
		return;
	}

	if (recipients.length > LARGE_GROUP_THRESHOLD) {
		console.warn(
			`announcement ${event.announcementId}: ${recipients.length} recipients exceeds the ` +
				`${LARGE_GROUP_THRESHOLD} this fan-out is shaped for — sending in one pass anyway`
		);
	}

	const href = announcementsHref(event.groupKind, event.groupSlug);
	const body = excerpt(event.body);

	// 3. In-app rows, chunked under D1's bound-parameter cap and grouped into
	//    batches. `db.batch`, never `db.transaction()` — broken on D1, and the
	//    `custom/no-db-transaction` lint rule errors on it.
	const inApp = recipients.filter((r) => r.inAppEnabled);
	if (inApp.length > 0) {
		try {
			const statements = [];
			for (let i = 0; i < inApp.length; i += NOTIFICATION_INSERT_CHUNK) {
				statements.push(
					db.insert(notification).values(
						inApp.slice(i, i + NOTIFICATION_INSERT_CHUNK).map((r) => ({
							userId: r.userId,
							type: 'announcement',
							title: `${event.groupName}: ${event.title}`,
							body,
							href,
							data: { announcementId: event.announcementId, groupId: event.groupId }
						}))
					)
				);
			}
			await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

			// The live push is per connection and in-memory, so it cannot be
			// batched. It is also the one step whose failure costs nothing — the row
			// is already written and the bell picks it up on the next poll.
			//
			// `id` is the announcement's, not the notification row's: the batch
			// insert deliberately does not `.returning()` the ids, and the bell
			// discards the payload and re-fetches on any message. Keeping the ids
			// would cost a statement per chunk to carry a value nothing reads.
			for (const r of inApp) {
				pushToUser(r.userId, {
					id: event.announcementId,
					type: 'announcement',
					title: `${event.groupName}: ${event.title}`,
					body,
					href,
					createdAt: new Date().toISOString()
				});
			}
		} catch (err) {
			captureException(err, {
				event: 'announcement.fanout',
				channel: 'in-app',
				announcementId: event.announcementId,
				recipients: inApp.length
			});
		}
	}

	// 4. One batched send per 500, on the transactional stream.
	const byEmail = recipients.filter((r) => r.emailEnabled);
	if (byEmail.length > 0) {
		try {
			await sendTemplateBatch(
				GENERIC_ALIAS,
				byEmail.map((r) => ({ to: r.email, model: emailModel(event, r, siteUrl) })),
				{ tag: 'announcement' }
			);
		} catch (err) {
			captureException(err, {
				event: 'announcement.fanout',
				channel: 'email',
				announcementId: event.announcementId,
				recipients: byEmail.length,
				batchSize: EMAIL_BATCH_SIZE
			});
		}
	}

	// 5. What the send actually reached, written last so it reflects the attempt
	//    rather than the intention.
	await recordRecipientCount(event.announcementId, recipients.length);
}
