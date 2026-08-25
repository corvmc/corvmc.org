import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ThreadTimeline from './ThreadTimeline.svelte';

/**
 * One timeline serves two readers with opposite ideas of "mine".
 *
 * Staff read a thread from the organisation's point of view: every outbound
 * message is ours, including a colleague's — so sides follow inbound/outbound.
 * A member reads their own conversation, where the staff reply is outbound but
 * emphatically *not* theirs. Orienting on author identity is what covers both,
 * and it is the rule that keeps working when neither party is staff.
 *
 * These tests pin the two modes against each other, because a change that fixes
 * one view by flipping the axis silently breaks the other.
 */

const MEMBER = 'member-1';

const messages = [
	{
		id: 'm1',
		direction: 'inbound' as const,
		body: 'Is a locker free?',
		authorName: 'Robin',
		authorUserId: MEMBER,
		createdAt: new Date('2026-01-01T10:00:00Z')
	},
	{
		id: 'm2',
		direction: 'outbound' as const,
		body: 'Yes, through Friday.',
		authorName: 'Ada',
		// Masked by getPortalThread: the member never receives staff user ids.
		authorUserId: null,
		createdAt: new Date('2026-01-01T11:00:00Z')
	}
];

function bubbleFor(body: string) {
	return page.getByText(body).element().closest('.chat');
}

describe('ThreadTimeline — member view (viewerUserId given)', () => {
	it('puts the member’s own message on the right and the staff reply on the left', async () => {
		await render(ThreadTimeline, { messages, viewerUserId: MEMBER });

		expect(bubbleFor('Is a locker free?')?.className).toContain('chat-end');
		expect(bubbleFor('Yes, through Friday.')?.className).toContain('chat-start');
	});

	it('does not fall back to direction for a message with no author id', async () => {
		// The regression this guards: treating a null author as "outbound, so
		// mine" would land every staff reply on the member's own side.
		await render(ThreadTimeline, { messages, viewerUserId: MEMBER });

		expect(bubbleFor('Yes, through Friday.')?.className).not.toContain('chat-end');
	});
});

describe('ThreadTimeline — staff view (no viewerUserId)', () => {
	it('keeps orienting by direction, so a colleague’s reply still reads as ours', async () => {
		await render(ThreadTimeline, { messages, contactName: 'Robin' });

		expect(bubbleFor('Is a locker free?')?.className).toContain('chat-start');
		expect(bubbleFor('Yes, through Friday.')?.className).toContain('chat-end');
	});

	it('still renders internal notes', async () => {
		await render(ThreadTimeline, {
			messages,
			contactName: 'Robin',
			notes: [
				{
					id: 'n1',
					body: 'Checked the locker list.',
					authorName: 'Ada',
					createdAt: new Date('2026-01-01T10:30:00Z')
				}
			]
		});

		await expect.element(page.getByText('Checked the locker list.')).toBeInTheDocument();
	});
});

describe('ThreadTimeline — notes', () => {
	it('renders none when the prop is omitted, as on member-facing pages', async () => {
		await render(ThreadTimeline, { messages, viewerUserId: MEMBER });

		expect(document.querySelectorAll('.border-dashed').length).toBe(0);
	});
});
