/**
 * Seed two staff-inbox threads that differ only in who the conversation is
 * waiting on, for the awaiting-reply e2e.
 *
 * Why a round trip is needed at all: the marker is written by one layer
 * (`addOutboundMessage` / `setAwaitingReply`), read by another (`listThreads`,
 * `getUnresolvedCount`), and rendered as a *derived* status. The two facts that
 * matter — an awaiting thread stays in the Open queue, and drops out of the nav
 * badge anyway — are the seam between those layers, and no unit test spans it.
 *
 * Both threads are `web`, so neither needs a channel enabled or an external
 * service to exist.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import { inboxThread, inboxMessage } from '../../src/lib/server/db/schema/inbox';

/** Staff replied and nobody has written back. */
export const SEED_AWAITING_THREAD_ID = 'e2e-inbox-awaiting';
export const SEED_AWAITING_CONTACT = 'E2E Awaiting Contact';

/** The contact wrote last, so this one is still owed an answer. */
export const SEED_NEEDS_REPLY_THREAD_ID = 'e2e-inbox-needs-reply';
export const SEED_NEEDS_REPLY_CONTACT = 'E2E Needs Reply Contact';

const THREAD_IDS = [SEED_AWAITING_THREAD_ID, SEED_NEEDS_REPLY_THREAD_ID];

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
			}
		]);
	});
}
