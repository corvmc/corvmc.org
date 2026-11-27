import { describe, it, expect, vi, beforeEach } from 'vitest';

// A band lists its Announcements thread in Messages before anything is posted
// (#3229), so reading the topics makes it; a club's topics stay as they were.

const { requireGroupRole, getOrCreateAnnouncementThread, listGroupTopics } = vi.hoisted(() => ({
	requireGroupRole: vi.fn(),
	getOrCreateAnnouncementThread: vi.fn(async () => 'announcements-1'),
	listGroupTopics: vi.fn(async () => [])
}));

vi.mock('$app/server', () => {
	// The handler itself, marked the way kit checks a remote module's exports.
	const passThrough =
		(type: string) =>
		(...args: unknown[]) => {
			const fn = args[args.length - 1] as Record<string, unknown>;
			fn.__ = { type };
			return fn;
		};
	return {
		getRequestEvent: () => ({ locals: {} }),
		query: passThrough('query'),
		form: passThrough('form'),
		command: passThrough('command')
	};
});
vi.mock('./direct-messages.remote', () => ({ getMyMessageThread: vi.fn() }));
vi.mock('#lib/server/group/group-context.js', () => ({ requireGroupRole }));
vi.mock('#lib/server/group/announcement-service.js', () => ({ getOrCreateAnnouncementThread }));
vi.mock('#lib/server/inbox/group-chat-service.js', () => ({
	getGroupChat: vi.fn(),
	postToGroupChat: vi.fn(),
	markGroupChatRead: vi.fn(),
	groupOfChatThread: vi.fn(),
	listGroupTopics,
	createGroupTopic: vi.fn(),
	setRoomMute: vi.fn()
}));

const { getGroupChatTopics } = (await import('./group-chat.remote')) as unknown as {
	getGroupChatTopics: (slug: string) => Promise<unknown>;
};

function asMemberOf(kind: string) {
	requireGroupRole.mockResolvedValue({
		user: { id: 'member-1' },
		group: { id: 'group-1', kind },
		role: 'member'
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getGroupChatTopics', () => {
	it("makes a band's Announcements thread before listing its topics", async () => {
		asMemberOf('band');
		await getGroupChatTopics('the-foos');

		expect(getOrCreateAnnouncementThread).toHaveBeenCalledWith('group-1');
		expect(getOrCreateAnnouncementThread.mock.invocationCallOrder[0]).toBeLessThan(
			listGroupTopics.mock.invocationCallOrder[0]
		);
	});

	it('leaves a club to make its own on the first post', async () => {
		asMemberOf('club');
		await getGroupChatTopics('real-book-club');

		expect(getOrCreateAnnouncementThread).not.toHaveBeenCalled();
		expect(listGroupTopics).toHaveBeenCalledWith('group-1', 'member-1');
	});
});
