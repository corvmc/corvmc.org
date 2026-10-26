import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { fakeCommand } from '$lib/test/fake-command.svelte';

// GroupChat renders the topic it is handed — on Messages the page's own query
// already carries it — and marks it seen exactly once.

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
// Not a bare vi.fn: the real command writes a $state on every call, and that
// write is what turned an untracked mark-seen effect into a loop (#1956).
const markGroupChatSeen = fakeCommand(async (_id: string) => ({ success: true }));

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

beforeEach(() => {
	vi.clearAllMocks();
	markGroupChatSeen.calls.length = 0;
});

describe('GroupChat', () => {
	it('renders the topic it is given without querying for it', async () => {
		await render(GroupChat, { chat, viewerUserId: 'member-1' });

		await expect.element(page.getByText('Autumn Leaves in G?')).toBeInTheDocument();
		expect(getGroupChatTopic).not.toHaveBeenCalled();
	});

	it('marks the topic it was given as seen, once', async () => {
		await render(GroupChat, { chat, viewerUserId: 'member-1' });

		await expect.poll(() => markGroupChatSeen.calls).toEqual(['topic-7']);
		// Settle, then re-check: a looping effect keeps calling after the first poll.
		await new Promise((r) => setTimeout(r, 100));
		expect(markGroupChatSeen.calls).toEqual(['topic-7']);
	});
});
