import { inboxMessage, inboxThread } from '../../src/lib/server/db/schema/inbox';
import { batchInsert } from './db';
import { type SeedUser } from './types';
import { randomUUID } from 'crypto';

/**
 * A few turns in each group's own thread, left unread so the Chat nav badge
 * has something to show.
 *
 * Like `band-enquiries.ts`, **no `inbox_participant` rows** — the roster is
 * resolved live. Unlike it, every message is `direction: 'peer'` with an
 * `authorUserId`: a chat is a room of named people.
 */
export async function seedGroupChats(
	groups: Array<{ id: string; name: string; ownerId: string }>,
	users: SeedUser[]
) {
	if (groups.length === 0 || users.length < 2) return { threads: 0, messages: 0 };

	console.log('Seeding group chats...');

	const now = Date.now();
	const hour = 3600_000;

	const threads: (typeof inboxThread.$inferInsert)[] = [];
	const messages: (typeof inboxMessage.$inferInsert)[] = [];

	// The owner and one other member, which is enough for the timeline to show
	// both sides — the viewer's own messages right, the other's left.
	for (const group of groups) {
		const owner = users.find((u) => u.id === group.ownerId);
		const other = users.find((u) => u.id !== group.ownerId);
		if (!owner || !other) continue;
		const roster = [owner, other];

		const threadId = randomUUID();
		const turns = [
			{ by: roster[0], body: 'Anyone free to run through the new set on Thursday?' },
			{ by: roster[1], body: 'I can do after 7. Bring the spare cable this time.' },
			{
				by: roster[0],
				body: 'Booked the room. Will drop the setlist in here tomorrow.'
			}
		];

		threads.push({
			id: threadId,
			channel: 'group',
			groupId: group.id,
			status: 'open',
			preview: turns[turns.length - 1].body.slice(0, 120),
			messageCount: turns.length,
			lastMessageAt: new Date(now - hour),
			createdAt: new Date(now - 6 * hour),
			updatedAt: new Date(now - hour)
		});

		turns.forEach((turn, i) => {
			messages.push({
				id: randomUUID(),
				threadId,
				direction: 'peer',
				body: turn.body,
				authorName: turn.by.name,
				authorUserId: turn.by.id,
				createdAt: new Date(now - (turns.length - i) * hour)
			});
		});
	}

	await batchInsert(inboxThread, threads);
	await batchInsert(inboxMessage, messages);

	return { threads: threads.length, messages: messages.length };
}
