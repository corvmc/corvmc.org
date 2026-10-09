import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

// GroupChat renders the topic it is handed. On Messages the page's own query
// already carries it, and a second query in flight beside that one is the
// suspected cause of #1776's effect loop — so the pane must not fetch.

function fakeRemoteForm() {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		enhance: () => ({ method: 'POST', action: '?/noop' }),
		fields: {
			threadId: field('threadId'),
			body: field('body'),
			intent: field('intent'),
			allIssues: () => null
		},
		result: undefined
	};
}

const getGroupChatTopic = vi.fn();
const markGroupChatSeen = vi.fn(async (_id: string) => ({ success: true }));

vi.mock('$lib/remote/group-chat.remote', () => ({
	getGroupChatTopic: (...a: unknown[]) => getGroupChatTopic(...a),
	markGroupChatSeen: (id: string) => markGroupChatSeen(id),
	postGroupChatMessage: fakeRemoteForm(),
	setRoomMute: fakeRemoteForm()
}));

const GroupChat = (await import('./GroupChat.test.svelte')).default;

const chat = {
	id: 'topic-7',
	groupName: 'Real Book Club',
	topicName: 'Setlists',
	isGeneral: false,
	muted: false,
	messages: [
		{
			id: 'm1',
			body: 'Autumn Leaves in G?',
			direction: 'inbound',
			authorName: 'Sam',
			authorUserId: 'member-2',
			createdAt: new Date('2026-10-01T18:00:00Z')
		}
	]
} as never;

beforeEach(() => vi.clearAllMocks());

describe('GroupChat', () => {
	it('renders the topic it is given without querying for it', async () => {
		await render(GroupChat, { chat, viewerUserId: 'member-1' });

		await expect.element(page.getByText('Autumn Leaves in G?')).toBeInTheDocument();
		expect(getGroupChatTopic).not.toHaveBeenCalled();
	});

	it('marks the topic it was given as seen, once', async () => {
		await render(GroupChat, { chat, viewerUserId: 'member-1' });

		await expect.poll(() => markGroupChatSeen.mock.calls).toEqual([['topic-7']]);
	});
});
