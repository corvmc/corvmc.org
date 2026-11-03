import { describe, it, expect, vi, beforeEach } from 'vitest';

// Topics are threads: `channel: 'group'` + group id + `subject`, a null
// subject meaning General (#1301). Nothing was migrated, so what matters is
// whether the rows already in the table still mean what they did: General is
// found by `subject IS NULL` rather than by being the only one, and it sorts
// first however quiet it gets. Plus the rule that keeps a fresh topic from
// wearing a dot nobody earned. Against a real SQLite.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
const emitted: [string, Record<string, unknown>][] = [];
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: {
		emit: (name: string, payload: Record<string, unknown>) => {
			emitted.push([name, payload]);
			return Promise.resolve();
		},
		on: vi.fn()
	}
}));

const {
	getOrCreateGroupChat,
	countGroupChatUnread,
	listGroupChatReaders,
	setRoomMute,
	listGroupTopics,
	createGroupTopic,
	postToGroupChat,
	publishGroupRoom,
	RoomIsReadOnlyError,
	TopicNameTakenError,
	GENERAL_TOPIC
} = await import('./group-chat-service');

const T0 = 1_750_000_000;

function topic(
	id: string,
	opts: {
		groupId?: string;
		subject?: string | null;
		lastAt?: number | null;
		postPolicy?: string;
		notifyPolicy?: string;
		publishedAt?: number | null;
	} = {}
) {
	sqlite
		.prepare(
			`insert into inbox_thread (id, channel, group_id, status, subject, last_message_at, post_policy, notify_policy, published_at)
			 values (?, 'group', ?, 'open', ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			opts.groupId ?? 'g1',
			opts.subject === undefined ? null : opts.subject,
			opts.lastAt === undefined ? null : opts.lastAt,
			opts.postPolicy ?? 'members',
			opts.notifyPolicy ?? 'in_app',
			opts.publishedAt ?? null
		);
}

function cursor(threadId: string, userId: string, lastReadAt: number | null, muted = false) {
	sqlite
		.prepare(
			`insert into inbox_group_read (id, thread_id, user_id, last_read_at, muted) values (?, ?, ?, ?, ?)`
		)
		.run(`r-${threadId}-${userId}`, threadId, userId, lastReadAt, muted ? 1 : 0);
}

function member(userId: string, status = 'active', groupId = 'g1') {
	sqlite
		.prepare(`insert or ignore into user (id, name, email) values (?, ?, ?)`)
		.run(userId, `Name ${userId}`, `${userId}@example.com`);
	sqlite
		.prepare(
			`insert into group_member (id, group_id, user_id, role, status) values (?, ?, ?, 'member', ?)`
		)
		.run(`gm-${groupId}-${userId}`, groupId, userId, status);
}

const threadsOf = (groupId: string) =>
	sqlite
		.prepare(`select id, subject from inbox_thread where group_id = ? order by id`)
		.all(groupId) as { id: string; subject: string | null }[];
const messageCount = () =>
	(sqlite.prepare('select count(*) as n from inbox_message').get() as { n: number }).n;

const post = (over: Partial<Parameters<typeof postToGroupChat>[0]> = {}) =>
	postToGroupChat({
		groupId: 'g1',
		groupName: 'The Band',
		userId: 'u1',
		userName: 'Ada',
		body: 'hi',
		threadId: 't1',
		...over
	});

beforeEach(() => {
	emitted.length = 0;
	for (const t of ['inbox_group_read', 'inbox_message', 'inbox_thread', 'group_member', 'user']) {
		sqlite.exec(`delete from "${t}"`);
	}
});

describe('getOrCreateGroupChat', () => {
	it('finds General by a null subject, not by being the only thread', async () => {
		// The lookup used to be (channel, groupId) alone, which was correct only
		// while a group could not have a second thread.
		topic('a-named', { subject: 'Tour' });
		topic('b-general');

		await expect(getOrCreateGroupChat('g1')).resolves.toBe('b-general');
	});

	it('creates General with no subject when the group has never opened one', async () => {
		topic('other-groups', { groupId: 'g2' });

		const id = await getOrCreateGroupChat('g1');

		expect(threadsOf('g1')).toEqual([{ id, subject: null }]);
		await expect(getOrCreateGroupChat('g1')).resolves.toBe(id);
	});
});

describe('listGroupTopics', () => {
	it('names a null subject General and marks it as such', async () => {
		topic('general');

		const [general] = await listGroupTopics('g1', 'u1');
		expect(general).toMatchObject({ id: 'general', name: GENERAL_TOPIC, isGeneral: true });
	});

	it('sorts General first, then by most recent', async () => {
		// General is the quietest here, and still on top — the room you land in
		// does not move.
		topic('general', { lastAt: T0 });
		topic('old', { subject: 'Old', lastAt: T0 + 1 });
		topic('new', { subject: 'New', lastAt: T0 + 2 });
		topic('elsewhere', { groupId: 'g2', subject: 'Not ours', lastAt: T0 + 3 });

		expect((await listGroupTopics('g1', 'u1')).map((t) => t.id)).toEqual(['general', 'new', 'old']);
	});

	it('marks a topic unread when it has said something since you last read', async () => {
		topic('general', { lastAt: T0 + 10 });
		cursor('general', 'u1', T0);

		expect((await listGroupTopics('g1', 'u1'))[0].unread).toBe(true);
	});

	it('leaves an empty topic read, however long you have ignored it', async () => {
		// Otherwise every topic wears a dot the moment somebody creates it.
		topic('general', { lastAt: null });

		expect((await listGroupTopics('g1', 'u1'))[0].unread).toBe(false);
	});

	it('leaves a topic read once you have caught up', async () => {
		topic('general', { lastAt: T0 });
		cursor('general', 'u1', T0 + 10);

		expect((await listGroupTopics('g1', 'u1'))[0].unread).toBe(false);
	});

	it('reads only this reader’s cursor', async () => {
		topic('general', { lastAt: T0 });
		cursor('general', 'u2', T0 + 10);

		expect((await listGroupTopics('g1', 'u1'))[0].unread).toBe(true);
	});

	it('never marks a muted topic unread, however much it has said', async () => {
		// A dot you cannot clear by not caring is not a mute (#1309).
		topic('general', { lastAt: T0 + 10 });
		cursor('general', 'u1', null, true);

		const [t] = await listGroupTopics('g1', 'u1');
		expect(t).toMatchObject({ unread: false, muted: true });
	});
});

describe('the per-room mute', () => {
	it('keeps a muted room out of the unread badge', async () => {
		// A reader with no cursor row at all is unread and unmuted both.
		topic('general', { lastAt: T0 });
		topic('muted', { subject: 'Muted', lastAt: T0 });
		cursor('muted', 'u1', null, true);
		topic('empty', { subject: 'Empty', lastAt: null });

		expect(await countGroupChatUnread('g1', 'u1')).toBe(1);
	});

	it('leaves the muted out of a room notification, for that room only', async () => {
		topic('t1');
		topic('t2', { subject: 'Other' });
		member('u1');
		member('u2');
		member('gone', 'left');
		cursor('t1', 'u1', null, true);
		// A mute on another room must not silence this one.
		cursor('t2', 'u2', null, true);

		const readers = await listGroupChatReaders('g1', 't1');

		expect(readers.map((r) => r.id)).toEqual(['u2']);
	});

	it('asks the roster and nothing else when no room is named', async () => {
		topic('t1');
		member('u1');
		member('u2');
		member('gone', 'left');
		cursor('t1', 'u1', null, true);

		const readers = await listGroupChatReaders('g1');

		expect(readers.map((r) => r.id).sort()).toEqual(['u1', 'u2']);
	});

	it('upserts, so a room can be muted before it is ever opened', async () => {
		topic('t1');

		await setRoomMute('t1', 'u1', true);
		await setRoomMute('t1', 'u1', false);

		expect(sqlite.prepare('select user_id, muted from inbox_group_read').all()).toEqual([
			{ user_id: 'u1', muted: 0 }
		]);
	});
});

describe('createGroupTopic', () => {
	it('opens a named topic when the name is free', async () => {
		// Another group's topic of the same name is no clash.
		topic('elsewhere', { groupId: 'g2', subject: 'Tour logistics' });

		const id = await createGroupTopic('g1', '  Tour logistics  ');

		// Trimmed, because " Tour" and "Tour" are the same topic to a reader.
		expect(threadsOf('g1')).toEqual([{ id, subject: 'Tour logistics' }]);
	});

	it('refuses a name the group already uses, whatever its case', async () => {
		topic('existing', { subject: 'Tour logistics' });

		await expect(createGroupTopic('g1', 'tour LOGISTICS')).rejects.toBeInstanceOf(
			TopicNameTakenError
		);
		expect(threadsOf('g1')).toHaveLength(1);
	});

	// A second General would be unreachable beside the null-subject one.
	it.each(['General', 'general', '  GENERAL '])('refuses %o', async (name) => {
		await expect(createGroupTopic('g1', name)).rejects.toBeInstanceOf(TopicNameTakenError);
		expect(threadsOf('g1')).toEqual([]);
	});
});

// #1304. A room differs from a chat topic on two axes and nothing else.
describe('room policy', () => {
	it('marks a leadership room read-only for a member, and not for a leader', async () => {
		topic('general');
		topic('a1', { subject: 'Notices', postPolicy: 'leadership', notifyPolicy: 'email' });

		const readOnly = async (isLeader: boolean) =>
			(await listGroupTopics('g1', 'u1', isLeader)).find((t) => t.id === 'a1')?.readOnly;
		expect(await readOnly(false)).toBe(true);
		expect(await readOnly(true)).toBe(false);
	});

	it('refuses a member posting to a leadership room', async () => {
		topic('t1', { postPolicy: 'leadership', notifyPolicy: 'email' });

		await expect(post({ isLeader: false })).rejects.toBeInstanceOf(RoomIsReadOnlyError);
		// Refused before the insert, not filtered after it.
		expect(messageCount()).toBe(0);
	});

	// A half-written notice must not reach the roster because somebody saved it.
	it('does not notify an unpublished email room', async () => {
		topic('t1', { postPolicy: 'leadership', notifyPolicy: 'email' });
		member('u1');
		member('u2');

		await post({ isLeader: true, body: 'draft' });

		expect(messageCount()).toBe(1);
		expect(emitted).toEqual([]);
	});

	it('notifies once it is published, says which policy, and skips the sender', async () => {
		topic('t1', { postPolicy: 'leadership', notifyPolicy: 'email', publishedAt: T0 });
		member('u1');
		member('u2');

		await post({ isLeader: true, body: 'Rehearsal moves' });

		expect(emitted.map(([name]) => name)).toEqual(['inbox.group_message']);
		// `email` routes the listener to the batched announcement fan-out; getting
		// this wrong is silent.
		expect(emitted[0][1]).toMatchObject({ notifyPolicy: 'email', recipientIds: ['u2'] });
	});

	it('keeps a chat topic on the quiet path', async () => {
		topic('t1');
		member('u1');
		member('u2');

		await post({ body: 'see you thursday' });

		// Unpublished, and it still notifies: publishing is a step an email room
		// has and a chat topic does not.
		expect(emitted[0][1]).toMatchObject({ notifyPolicy: 'in_app' });
	});
});

describe('publishGroupRoom', () => {
	// The latch. At-least-once delivery means the second publish must report
	// nothing, or the roster is emailed twice.
	it('stamps once, and reports nothing on a second publish', async () => {
		topic('t1', { notifyPolicy: 'email' });

		await expect(publishGroupRoom('t1')).resolves.toBe(true);
		await expect(publishGroupRoom('t1')).resolves.toBe(false);
	});
});
