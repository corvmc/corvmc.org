import { describe, it, expect, vi, beforeEach } from 'vitest';

// Messages renders a group topic out of getMyMessageThread, not
// getGroupChatTopic (#1776). A mutation that refreshed only the latter would
// leave that pane showing the topic as it was before the post or the mute.

const refreshed: string[] = [];
const refreshable = (name: string) => (arg: unknown) => ({
	refresh: async () => {
		refreshed.push(`${name}(${JSON.stringify(arg)})`);
	}
});

vi.mock('./direct-messages.remote', () => ({
	getMyMessageThread: refreshable('getMyMessageThread')
}));
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: vi.fn(async () => ({
		user: { id: 'member-1', name: 'Robin' },
		group: { id: 'group-1', name: 'Real Book Club' },
		role: 'member'
	}))
}));
vi.mock('$lib/server/inbox/group-chat-service', () => ({
	getGroupChat: vi.fn(),
	postToGroupChat: vi.fn(async () => undefined),
	markGroupChatRead: vi.fn(),
	groupOfChatThread: vi.fn(async () => ({ id: 'group-1', slug: 'realbookclub' })),
	listGroupTopics: vi.fn(),
	createGroupTopic: vi.fn(),
	setRoomMute: vi.fn(async () => undefined)
}));

// Queries are their own stubs so a refresh on one is visible by name.
vi.mock('$app/server', () => {
	const mark = (fn: unknown, type: string) => {
		(fn as Record<string, unknown>).__ = { type };
		return fn;
	};
	let queries = 0;
	const names = ['getGroupChatThread', 'getGroupChatTopics', 'getGroupChatTopic'];
	return {
		getRequestEvent: () => ({ locals: {} }),
		query: () => mark(refreshable(names[queries++] ?? 'query'), 'query'),
		form: (...args: unknown[]) => mark(args[args.length - 1], 'form'),
		command: (...args: unknown[]) => mark(args[args.length - 1], 'command')
	};
});

const remote = (await import('./group-chat.remote')) as unknown as Record<
	string,
	(data: unknown, issue?: unknown) => Promise<unknown>
>;

beforeEach(() => {
	refreshed.length = 0;
});

describe('group chat mutations refresh the Messages pane', () => {
	it('a post refreshes the thread Messages reads, alongside the topic', async () => {
		await remote.postGroupChatMessage({ threadId: 'topic-7', body: 'Hello' });

		expect(refreshed).toContain('getMyMessageThread("topic-7")');
		expect(refreshed).toContain('getGroupChatTopic("topic-7")');
	});

	it('a mute refreshes the thread Messages reads', async () => {
		await remote.setRoomMute({ threadId: 'topic-7', intent: 'mute' });

		expect(refreshed).toContain('getMyMessageThread("topic-7")');
	});
});
