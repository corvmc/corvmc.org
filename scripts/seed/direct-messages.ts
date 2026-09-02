import { user } from '../../src/lib/server/db/schema/authentication';
import { contentFlag } from '../../src/lib/server/db/schema/flag';
import { inboxMessage, inboxParticipant, inboxThread } from '../../src/lib/server/db/schema/inbox';
import { userBlock } from '../../src/lib/server/db/schema/moderation';
import { memberStanding } from '../../src/lib/server/db/schema/standing';
import { batchInsert, db } from './db';
import { type SeedUser } from './types';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * Member↔member conversations, covering every state the UI has to render:
 * an accepted conversation, a request waiting on a decision, a request the
 * sender is still waiting on, a block, a member on probation, a member who
 * switched their own messaging off, and a reported conversation in triage.
 */
export async function seedDirectMessages(users: SeedUser[], adminUser: SeedUser) {
	const now = new Date();
	const hour = 3600_000;
	const day = 24 * hour;

	// Six distinct members so no two scenarios interfere.
	const [alice, bob, carol, dave, erin, frank] = users.slice(0, 6);
	if (!frank) return { threads: 0, blocks: 0, standings: 0 };

	const accepted = randomUUID();
	const pendingForBob = randomUUID();
	const pendingFromCarol = randomUUID();
	const reported = randomUUID();

	const threads = await batchInsert(
		inboxThread,
		[
			{
				id: accepted,
				channel: 'direct' as const,
				status: 'open' as const,
				preview: 'Sounds good — Thursday works for me. I can bring an amp.',
				messageCount: 3,
				lastMessageAt: new Date(now.getTime() - 2 * hour),
				createdAt: new Date(now.getTime() - 3 * day),
				updatedAt: new Date(now.getTime() - 2 * hour)
			},
			{
				id: pendingForBob,
				channel: 'direct' as const,
				status: 'open' as const,
				preview: 'Hi! Saw you play bass at the open mic — I am putting a soul band together.',
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - 6 * hour),
				createdAt: new Date(now.getTime() - 6 * hour),
				updatedAt: new Date(now.getTime() - 6 * hour)
			},
			{
				id: pendingFromCarol,
				channel: 'direct' as const,
				status: 'open' as const,
				preview: 'Are you still looking for a drummer?',
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - day),
				createdAt: new Date(now.getTime() - day),
				updatedAt: new Date(now.getTime() - day)
			},
			{
				id: reported,
				channel: 'direct' as const,
				// Reporting closes the conversation, same as declining.
				status: 'resolved' as const,
				preview: 'I said I am not interested. Please stop messaging me.',
				messageCount: 3,
				lastMessageAt: new Date(now.getTime() - 2 * day),
				createdAt: new Date(now.getTime() - 4 * day),
				updatedAt: new Date(now.getTime() - 2 * day)
			}
		],
		2
	);

	// acceptedAt is the request mechanism: stamped on the person who started the
	// conversation, null on the recipient until they accept.
	await batchInsert(
		inboxParticipant,
		[
			{
				id: randomUUID(),
				threadId: accepted,
				userId: alice.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 3 * day),
				lastReadAt: new Date(now.getTime() - 2 * hour),
				createdAt: new Date(now.getTime() - 3 * day)
			},
			{
				id: randomUUID(),
				threadId: accepted,
				userId: bob.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 3 * day),
				lastReadAt: new Date(now.getTime() - 3 * hour),
				createdAt: new Date(now.getTime() - 3 * day)
			},

			// Waiting on Bob: he sees this in Messages tagged "Request".
			{
				id: randomUUID(),
				threadId: pendingForBob,
				userId: carol.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 6 * hour),
				lastReadAt: new Date(now.getTime() - 6 * hour),
				createdAt: new Date(now.getTime() - 6 * hour)
			},
			{
				id: randomUUID(),
				threadId: pendingForBob,
				userId: bob.id,
				role: 'member' as const,
				acceptedAt: null,
				lastReadAt: null,
				createdAt: new Date(now.getTime() - 6 * hour)
			},

			// Waiting on Dave: counts against Carol's outstanding-request cap.
			{
				id: randomUUID(),
				threadId: pendingFromCarol,
				userId: carol.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - day),
				lastReadAt: new Date(now.getTime() - day),
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: pendingFromCarol,
				userId: dave.id,
				role: 'member' as const,
				acceptedAt: null,
				lastReadAt: null,
				createdAt: new Date(now.getTime() - day)
			},

			{
				id: randomUUID(),
				threadId: reported,
				userId: erin.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 4 * day),
				lastReadAt: new Date(now.getTime() - 2 * day),
				createdAt: new Date(now.getTime() - 4 * day)
			},
			{
				id: randomUUID(),
				threadId: reported,
				userId: frank.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 4 * day),
				lastReadAt: null,
				createdAt: new Date(now.getTime() - 4 * day)
			}
		],
		2
	);

	// Every DM is 'peer': nobody wrote to CorvMC and CorvMC sent nothing.
	await batchInsert(
		inboxMessage,
		[
			{
				id: randomUUID(),
				threadId: accepted,
				direction: 'peer' as const,
				body: 'Hey — are you free to jam this week?',
				authorName: alice.name,
				authorUserId: alice.id,
				createdAt: new Date(now.getTime() - 3 * day)
			},
			{
				id: randomUUID(),
				threadId: accepted,
				direction: 'peer' as const,
				body: 'Yeah! Thursday or Saturday both work.',
				authorName: bob.name,
				authorUserId: bob.id,
				createdAt: new Date(now.getTime() - 2 * day)
			},
			{
				id: randomUUID(),
				threadId: accepted,
				direction: 'peer' as const,
				body: 'Sounds good — Thursday works for me. I can bring an amp.',
				authorName: alice.name,
				authorUserId: alice.id,
				createdAt: new Date(now.getTime() - 2 * hour)
			},

			{
				id: randomUUID(),
				threadId: pendingForBob,
				direction: 'peer' as const,
				body: 'Hi! Saw you play bass at the open mic — I am putting a soul band together and wondered if you were looking for something.',
				authorName: carol.name,
				authorUserId: carol.id,
				createdAt: new Date(now.getTime() - 6 * hour)
			},

			{
				id: randomUUID(),
				threadId: pendingFromCarol,
				direction: 'peer' as const,
				body: 'Are you still looking for a drummer?',
				authorName: carol.name,
				authorUserId: carol.id,
				createdAt: new Date(now.getTime() - day)
			},

			{
				id: randomUUID(),
				threadId: reported,
				direction: 'peer' as const,
				body: 'Hi, want to get a drink sometime?',
				authorName: frank.name,
				authorUserId: frank.id,
				createdAt: new Date(now.getTime() - 4 * day)
			},
			{
				id: randomUUID(),
				threadId: reported,
				direction: 'peer' as const,
				body: 'No thanks, I am just here for the music.',
				authorName: erin.name,
				authorUserId: erin.id,
				createdAt: new Date(now.getTime() - 3 * day)
			},
			{
				id: randomUUID(),
				threadId: reported,
				direction: 'peer' as const,
				body: 'I said I am not interested. Please stop messaging me.',
				authorName: erin.name,
				authorUserId: erin.id,
				createdAt: new Date(now.getTime() - 2 * day)
			}
		],
		3
	);

	// Reporting blocks the other person straight away — the reporter should not
	// have to wait on the staff queue to stop hearing from them.
	const blocks = await batchInsert(
		userBlock,
		[
			{
				id: randomUUID(),
				blockerUserId: erin.id,
				blockedUserId: frank.id,
				source: 'reported' as const,
				createdAt: new Date(now.getTime() - 2 * day)
			},
			{
				id: randomUUID(),
				blockerUserId: dave.id,
				blockedUserId: alice.id,
				source: 'declined_request' as const,
				createdAt: new Date(now.getTime() - 5 * day)
			}
		],
		2
	);

	const reportFlag = randomUUID();
	await batchInsert(
		contentFlag,
		[
			{
				id: reportFlag,
				entityType: 'inbox_thread' as const,
				entityId: reported,
				reportedByUserId: erin.id,
				reason: 'Harassment',
				description: 'They kept messaging after I said no.',
				status: 'pending' as const,
				createdAt: new Date(now.getTime() - 2 * day),
				updatedAt: new Date(now.getTime() - 2 * day)
			}
		],
		1
	);

	// Probation from an upheld report: Frank can reply where he already is, but
	// cannot start anything new. A moderation record, so it is a standing row.
	const standings = await batchInsert(
		memberStanding,
		[
			{
				userId: frank.id,
				scope: 'messaging' as const,
				status: 'restricted' as const,
				reason: 'Continued messaging after being asked to stop.',
				triggeringFlagId: reportFlag,
				updatedByUserId: adminUser.id,
				updatedAt: new Date(now.getTime() - day)
			}
		],
		1
	);

	// Dave switched his own messaging off. Deliberately NOT a standing row —
	// nothing was imposed on him, so there is no moderation record to write, and
	// staff have nothing to restore. It is a preference on his user row, and it
	// is the reason `member_standing` needs no `source` column.
	await db.update(user).set({ acceptsDirectMessages: false }).where(eq(user.id, dave.id));

	return { threads: threads.length, blocks: blocks.length, standings: standings.length };
}
