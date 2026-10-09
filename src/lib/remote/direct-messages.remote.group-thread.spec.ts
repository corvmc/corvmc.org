import { describe, it, expect, vi, beforeEach } from 'vitest';

// The group branch of getMyMessageThread is the whole of what Messages renders
// for a group's chat: the page hands it to GroupChat instead of letting that
// pane await getGroupChatTopic as well (#1776). So it has to be the topic the
// id names, read as this viewer, not the group's General room.

const currentUser = { id: 'member-1', name: 'Robin', email: 'robin@example.com' };

const getGroupChat = vi.fn(async (groupId: string, threadId?: string, userId?: string) => ({
	id: threadId ?? 'general-thread',
	groupName: 'Real Book Club',
	topicName: 'Setlists',
	isGeneral: false,
	muted: userId === 'member-1',
	messages: []
}));
const groupOfThread = vi.fn(async (_id: string) => ({
	id: 'group-1',
	slug: 'realbookclub',
	name: 'Real Book Club',
	channel: 'group' as const
}));

vi.mock('$lib/server/authorization', () => ({ requireUser: () => currentUser }));
vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn() }));
vi.mock('$lib/server/inbox/direct-service', () => ({
	startDirectThread: vi.fn(),
	replyToDirectThread: vi.fn(),
	acceptDirectThread: vi.fn(),
	declineDirectThread: vi.fn(),
	getDirectThread: vi.fn(async () => null),
	counterpartOf: vi.fn()
}));
vi.mock('$lib/server/inbox/portal-service', () => ({ getPortalThread: vi.fn(async () => null) }));
vi.mock('$lib/server/inbox/group-chat-service', () => ({
	getGroupChat: (...a: [string, string?, string?]) => getGroupChat(...a)
}));
vi.mock('$lib/server/inbox/band-service', () => ({ getBandThread: vi.fn() }));
vi.mock('$lib/server/inbox/unified-service', () => ({
	listUnifiedConversations: vi.fn(),
	groupOfThread: (id: string) => groupOfThread(id)
}));
vi.mock('$lib/server/band/band-service', () => ({
	listForUser: vi.fn(async () => [{ id: 'group-1', status: 'active', role: 'member' }])
}));
vi.mock('$lib/server/moderation/moderation-service', () => ({
	blockUser: vi.fn(),
	unblockUser: vi.fn(),
	listBlockedBy: vi.fn(),
	getMessagingState: vi.fn(),
	setAcceptsDirectMessages: vi.fn()
}));
vi.mock('$lib/server/flag/flag-service', () => ({
	createFlag: vi.fn(),
	countUnresolvedReportsBy: vi.fn(),
	FLAG_REASON_MAX: 100,
	FLAG_DESCRIPTION_MAX: 1000
}));
vi.mock('$lib/server/inbox/thread-service', () => ({ updateStatus: vi.fn() }));
vi.mock('$lib/remote/layout.remote', () => ({
	getMemberLayout: () => ({ refresh: () => undefined })
}));

vi.mock('$app/server', () => {
	const mark = (fn: unknown, type: string) => {
		(fn as Record<string, unknown>).__ = { type };
		return fn;
	};
	const bare = (...args: unknown[]) => args[args.length - 1];
	return {
		getRequestEvent: () => ({ locals: { user: currentUser } }),
		query: (...args: unknown[]) => mark(bare(...args), 'query'),
		form: (...args: unknown[]) => {
			const fn = mark(bare(...args), 'form') as Record<string, unknown>;
			fn.for = () => fn;
			return fn;
		},
		command: (...args: unknown[]) => mark(bare(...args), 'command')
	};
});

const { getMyMessageThread } = (await import('./direct-messages.remote')) as unknown as {
	getMyMessageThread: (id: string) => Promise<Record<string, unknown>>;
};

beforeEach(() => vi.clearAllMocks());

describe('getMyMessageThread on a group chat topic', () => {
	it('loads the topic the id names, as the viewer', async () => {
		await getMyMessageThread('topic-7');

		expect(getGroupChat).toHaveBeenCalledWith('group-1', 'topic-7', 'member-1');
	});

	it('returns that topic with the viewer’s own state, ready for GroupChat', async () => {
		const t = await getMyMessageThread('topic-7');

		expect(t).toMatchObject({
			kind: 'group',
			id: 'topic-7',
			viewerUserId: 'member-1',
			groupSlug: 'realbookclub',
			topicName: 'Setlists',
			muted: true
		});
	});
});
