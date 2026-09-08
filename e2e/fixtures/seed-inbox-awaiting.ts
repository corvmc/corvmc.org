/**
 * Seed three staff-inbox threads, one per state the queue can put a thread in,
 * for the awaiting-reply e2e.
 *
 * Why a round trip is needed at all: the marker is written by one layer
 * (`addOutboundMessage` / `setAwaitingReply`), read by another (`listThreads`,
 * `getUnresolvedCount`), and rendered as a *derived* status. The fact that
 * matters — Open holds what needs a human and Snoozed holds everything parked,
 * on a date or on a reply, and the nav badge is exactly the first of those — is
 * the seam between those layers, and no unit test spans it.
 *
 * The snoozed row is here because Snoozed absorbed the awaiting view, and its
 * whole premise is that the two are still told apart on the row. Nothing
 * asserts that without both kinds sitting in the same list.
 *
 * Three of the four are `web`, so none needs a channel enabled or an external
 * service to exist. The fourth is Instagram, and does need the channel switched
 * on — see {@link SEED_META_STALE_THREAD_ID}.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { eq, inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import {
	inboxThread,
	inboxMessage,
	inboxChannelConfig
} from '../../src/lib/server/db/schema/inbox';

/** Staff replied and nobody has written back. */
export const SEED_AWAITING_THREAD_ID = 'e2e-inbox-awaiting';
export const SEED_AWAITING_CONTACT = 'E2E Awaiting Contact';

/** The contact wrote last, so this one is still owed an answer. */
export const SEED_NEEDS_REPLY_THREAD_ID = 'e2e-inbox-needs-reply';
export const SEED_NEEDS_REPLY_CONTACT = 'E2E Needs Reply Contact';

/** Parked on a date rather than on a person — the other half of Snoozed. */
export const SEED_SNOOZED_THREAD_ID = 'e2e-inbox-snoozed';
export const SEED_SNOOZED_CONTACT = 'E2E Snoozed Contact';

/**
 * An Instagram thread whose last inbound message is older than Meta's 7-day
 * reply window.
 *
 * The one composer state nobody can reach by clicking: it depends on the age of
 * a row, so it cannot be produced from the UI, and it is decided page-side from
 * the thread's messages — a seam no unit test spans. Left blocked, a staffer
 * finds out by writing a reply and watching Meta refuse it.
 */
export const SEED_META_STALE_THREAD_ID = 'e2e-inbox-meta-stale';
export const SEED_META_STALE_CONTACT = 'E2E Instagram Contact';

const THREAD_IDS = [
	SEED_AWAITING_THREAD_ID,
	SEED_NEEDS_REPLY_THREAD_ID,
	SEED_SNOOZED_THREAD_ID,
	SEED_META_STALE_THREAD_ID
];

export async function seedInboxAwaiting(): Promise<void> {
	await withPlatformDb(async (db) => {
		await db.delete(inboxMessage).where(inArray(inboxMessage.threadId, THREAD_IDS));
		await db.delete(inboxThread).where(inArray(inboxThread.id, THREAD_IDS));

		const now = new Date();
		const hour = 3600_000;

		await db.insert(inboxThread).values([
			{
				id: SEED_AWAITING_THREAD_ID,
				channel: 'web' as const,
				status: 'open' as const,
				subject: 'E2E awaiting subject',
				preview: 'Yes — student rates are on the membership page.',
				contactName: SEED_AWAITING_CONTACT,
				contactEmail: 'e2e.awaiting@example.com',
				awaitingReplySince: new Date(now.getTime() - hour),
				lastOutboundAt: new Date(now.getTime() - hour),
				messageCount: 2,
				lastMessageAt: new Date(now.getTime() - hour),
				createdAt: new Date(now.getTime() - 4 * hour),
				updatedAt: new Date(now.getTime() - hour)
			},
			{
				id: SEED_NEEDS_REPLY_THREAD_ID,
				channel: 'web' as const,
				status: 'open' as const,
				subject: 'E2E needs reply subject',
				preview: 'Do you rent the space for rehearsals on Sundays?',
				contactName: SEED_NEEDS_REPLY_CONTACT,
				contactEmail: 'e2e.needsreply@example.com',
				awaitingReplySince: null,
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - 2 * hour),
				createdAt: new Date(now.getTime() - 2 * hour),
				updatedAt: new Date(now.getTime() - 2 * hour)
			},
			{
				id: SEED_SNOOZED_THREAD_ID,
				channel: 'web' as const,
				status: 'snoozed' as const,
				subject: 'E2E snoozed subject',
				preview: 'Circling back after the board meeting.',
				contactName: SEED_SNOOZED_CONTACT,
				contactEmail: 'e2e.snoozed@example.com',
				// Far enough out that `wakeSnoozedThreads` cannot reach it if the
				// cron happens to run against this database mid-suite.
				snoozedUntil: new Date(now.getTime() + 3 * 24 * hour),
				awaitingReplySince: null,
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - 3 * hour),
				createdAt: new Date(now.getTime() - 3 * hour),
				updatedAt: new Date(now.getTime() - 3 * hour)
			},
			{
				id: SEED_META_STALE_THREAD_ID,
				channel: 'instagram' as const,
				status: 'open' as const,
				preview: 'is the open mic still on for thursday?',
				contactName: SEED_META_STALE_CONTACT,
				contactExternalId: 'e2e-igsid-1',
				awaitingReplySince: null,
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - 9 * 24 * hour),
				createdAt: new Date(now.getTime() - 9 * 24 * hour),
				updatedAt: new Date(now.getTime() - 9 * 24 * hour)
			}
		]);

		// The messages behind those previews. The timeline is not what these tests
		// assert on, but a thread with a message count and no messages reads as a
		// bug to anyone who opens the fixture in the UI.
		await db.insert(inboxMessage).values([
			{
				id: 'e2e-inbox-awaiting-in',
				threadId: SEED_AWAITING_THREAD_ID,
				direction: 'inbound' as const,
				body: 'Do you offer a student rate?',
				authorName: SEED_AWAITING_CONTACT,
				createdAt: new Date(now.getTime() - 4 * hour)
			},
			{
				id: 'e2e-inbox-awaiting-out',
				threadId: SEED_AWAITING_THREAD_ID,
				direction: 'outbound' as const,
				body: 'Yes — student rates are on the membership page.',
				authorName: 'E2E Staff Operator',
				createdAt: new Date(now.getTime() - hour)
			},
			{
				id: 'e2e-inbox-needs-reply-in',
				threadId: SEED_NEEDS_REPLY_THREAD_ID,
				direction: 'inbound' as const,
				body: 'Do you rent the space for rehearsals on Sundays?',
				authorName: SEED_NEEDS_REPLY_CONTACT,
				createdAt: new Date(now.getTime() - 2 * hour)
			},
			{
				id: 'e2e-inbox-snoozed-in',
				threadId: SEED_SNOOZED_THREAD_ID,
				direction: 'inbound' as const,
				body: 'Circling back after the board meeting.',
				authorName: SEED_SNOOZED_CONTACT,
				createdAt: new Date(now.getTime() - 3 * hour)
			},
			{
				// Nine days old, which is what puts the thread past the window.
				id: 'e2e-inbox-meta-stale-in',
				threadId: SEED_META_STALE_THREAD_ID,
				direction: 'inbound' as const,
				body: 'is the open mic still on for thursday?',
				authorName: SEED_META_STALE_CONTACT,
				channelMessageId: 'e2e-mid-1',
				createdAt: new Date(now.getTime() - 9 * 24 * hour)
			}
		]);

		// The window message only shows once the channel is on: the composer
		// reports a disabled channel first, and rightly so — that is the more
		// basic reason a reply cannot be sent. Nothing is ever dispatched here, so
		// enabling it costs nothing.
		const [existing] = await db
			.select()
			.from(inboxChannelConfig)
			.where(eq(inboxChannelConfig.channel, 'instagram'))
			.limit(1);

		if (existing) {
			await db
				.update(inboxChannelConfig)
				.set({ enabled: true })
				.where(eq(inboxChannelConfig.channel, 'instagram'));
		} else {
			await db
				.insert(inboxChannelConfig)
				.values({ id: 'e2e-inbox-channel-instagram', channel: 'instagram', enabled: true });
		}
	});
}
