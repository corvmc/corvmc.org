/**
 * Seed member↔member messaging for the e2e suite.
 *
 * Why this exists: nothing in the messaging feature had end-to-end coverage,
 * and that is the direct reason a dropped table reached main. `messaging_standing`
 * was consolidated away and four hand-written SQL fragments went on naming it,
 * so `/member/messages` raised "no such table" for every member — while 2200
 * unit tests stayed green, because the service specs mock `db` wholesale and
 * never execute the SQL they capture.
 *
 * So the single most valuable assertion here is the cheapest one: the Messages
 * page renders at all. Everything after it is the consent lifecycle, which is
 * all client-server round trips over state that has to move one way —
 *
 *   - a request is EXACTLY ONE message until it is accepted. Enforced in SQL,
 *     and the protection the whole design rests on.
 *   - accepting turns it into an ordinary conversation both sides can write in.
 *   - blocking closes it without destroying it: the history has to survive,
 *     because the person who blocked still needs it if they later report.
 *
 * Two members, and neither is staff: a DM must never surface in the staff
 * inbox, and a staff account on either end would hide that.
 *
 * Idempotent: deletes and recreates its own rows, and clears its own KV
 * counters, on every run.
 */
import { eq, inArray } from 'drizzle-orm';
import { withPlatformDb, withPlatformEnv } from './platform-db';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { userBlock } from '../../src/lib/server/db/schema/moderation';
import { memberStanding } from '../../src/lib/server/db/schema/standing';
import { inboxThread, inboxParticipant, inboxMessage } from '../../src/lib/server/db/schema/inbox';
import { scryptHash } from './seed-pay-reservation';

export const SEED_MSG_PASSWORD = 'e2e-password-123';

/** Starts the conversation. */
export const SEED_MSG_SENDER_ID = 'e2e-msg-sender';
export const SEED_MSG_SENDER_EMAIL = 'e2e.msg.sender@example.com';
export const SEED_MSG_SENDER_NAME = 'E2E Message Sender';

/** Receives it, and decides. */
export const SEED_MSG_RECIPIENT_ID = 'e2e-msg-recipient';
export const SEED_MSG_RECIPIENT_EMAIL = 'e2e.msg.recipient@example.com';
export const SEED_MSG_RECIPIENT_NAME = 'E2E Message Recipient';

/**
 * A member↔staff thread, so the staff queue is never empty.
 *
 * Seeded rather than created by the member-side test: the staff filter test
 * asserts that opening a thread does not throw you back to the list, and it
 * should not silently skip itself because a sibling test has not run. Same
 * reason `seed-suggestions.ts` seeds its own pending edit.
 */
export const SEED_MSG_PORTAL_THREAD_ID = 'e2e-msg-portal-thread';
export const SEED_MSG_PORTAL_SUBJECT = 'E2E Portal Thread For Staff';

const MEMBER_IDS = [SEED_MSG_SENDER_ID, SEED_MSG_RECIPIENT_ID];

export async function seedMessaging(): Promise<void> {
	await resetMessagingRateLimits();
	await withPlatformDb(async (db) => {
		// Threads first: participants and messages cascade off them, and the
		// blocks and standing point at the users.
		const threads = await db
			.select({ id: inboxThread.id })
			.from(inboxThread)
			.innerJoin(inboxParticipant, eq(inboxParticipant.threadId, inboxThread.id))
			.where(inArray(inboxParticipant.userId, MEMBER_IDS));
		const threadIds = [...new Set(threads.map((t) => t.id))];
		if (threadIds.length > 0) {
			await db.delete(inboxMessage).where(inArray(inboxMessage.threadId, threadIds));
			await db.delete(inboxParticipant).where(inArray(inboxParticipant.threadId, threadIds));
			await db.delete(inboxThread).where(inArray(inboxThread.id, threadIds));
		}
		await db.delete(userBlock).where(inArray(userBlock.blockerUserId, MEMBER_IDS));
		await db.delete(userBlock).where(inArray(userBlock.blockedUserId, MEMBER_IDS));
		await db.delete(memberStanding).where(inArray(memberStanding.userId, MEMBER_IDS));
		await db.delete(account).where(inArray(account.userId, MEMBER_IDS));
		await db.delete(user).where(inArray(user.id, MEMBER_IDS));

		const now = new Date();
		const passwordHash = await scryptHash(SEED_MSG_PASSWORD);

		for (const [id, email, name] of [
			[SEED_MSG_SENDER_ID, SEED_MSG_SENDER_EMAIL, SEED_MSG_SENDER_NAME],
			[SEED_MSG_RECIPIENT_ID, SEED_MSG_RECIPIENT_EMAIL, SEED_MSG_RECIPIENT_NAME]
		] as const) {
			await db.insert(user).values({
				id,
				name,
				email,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
				// Both halves of reachability, set explicitly rather than left to the
				// column defaults: these two flags are exactly what the regression
				// broke, so the fixture should say what it expects them to be.
				acceptsDirectMessages: true,
				directoryVisibility: 'members'
			});
			await db.insert(account).values({
				id: `${id}-account`,
				accountId: id,
				providerId: 'credential',
				userId: id,
				password: passwordHash,
				createdAt: now,
				updatedAt: now
			});
		}

		// One portal thread, which staff DO see — the counterpoint to the direct
		// threads the member test creates, which they must not.
		await db.delete(inboxThread).where(eq(inboxThread.id, SEED_MSG_PORTAL_THREAD_ID));
		await db.insert(inboxThread).values({
			id: SEED_MSG_PORTAL_THREAD_ID,
			channel: 'portal',
			status: 'open',
			subject: SEED_MSG_PORTAL_SUBJECT,
			preview: 'Seeded for the e2e suite.',
			messageCount: 1,
			lastMessageAt: now,
			createdAt: now,
			updatedAt: now
		});
		await db.insert(inboxParticipant).values({
			threadId: SEED_MSG_PORTAL_THREAD_ID,
			userId: SEED_MSG_SENDER_ID,
			role: 'member',
			acceptedAt: now,
			createdAt: now
		});
		await db.insert(inboxMessage).values({
			threadId: SEED_MSG_PORTAL_THREAD_ID,
			direction: 'inbound',
			body: 'Seeded for the e2e suite.',
			authorUserId: SEED_MSG_SENDER_ID,
			authorName: SEED_MSG_SENDER_NAME,
			createdAt: now
		});
	});
}

/**
 * Clear the senders' KV rate-limit counters.
 *
 * `startDirectThread` allows 5 new conversations per member per day and
 * `replyToDirectThread` 60 messages per hour, and KV survives between runs in
 * the suite's state directory. Without this the sixth run of the suite simply
 * stops delivering — and because every one of those refusals is a deliberate
 * silent drop returning `{ status: 'sent' }`, it surfaces as a request that
 * never arrives, with no error anywhere to explain it.
 */
async function resetMessagingRateLimits(): Promise<void> {
	await withPlatformEnv(async ({ env }) => {
		const kv = env.KV as KVNamespace | undefined;
		if (!kv) return;
		for (const id of MEMBER_IDS) {
			await kv.delete(`rate-limit:dm-request:${id}`);
			await kv.delete(`rate-limit:dm-send:${id}`);
		}
	});
}
