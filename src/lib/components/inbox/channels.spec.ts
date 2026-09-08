import { describe, it, expect } from 'vitest';
import { isMetaReplyWindowClosed, channelLabel, channelIcon } from './channels';

const NOW = new Date('2026-09-03T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

function inbound(daysAgo: number) {
	return { direction: 'inbound', createdAt: new Date(NOW - daysAgo * DAY) };
}

function outbound(daysAgo: number) {
	return { direction: 'outbound', createdAt: new Date(NOW - daysAgo * DAY) };
}

describe('isMetaReplyWindowClosed', () => {
	it.each(['instagram', 'messenger'])('blocks a %s thread past seven days', (channel) => {
		expect(isMetaReplyWindowClosed(channel, [inbound(9)], NOW)).toBe(true);
	});

	it.each(['instagram', 'messenger'])('allows a %s thread inside seven days', (channel) => {
		expect(isMetaReplyWindowClosed(channel, [inbound(6)], NOW)).toBe(false);
	});

	// The dispatcher's HUMAN_AGENT tag buys exactly seven days, so the boundary
	// is where a too-eager block would take the channel out of service a day
	// early and a too-lax one would let a doomed reply through.
	it('allows a thread at exactly seven days and blocks one just past it', () => {
		expect(isMetaReplyWindowClosed('instagram', [inbound(7)], NOW)).toBe(false);
		expect(
			isMetaReplyWindowClosed(
				'instagram',
				[{ direction: 'inbound', createdAt: new Date(NOW - 7 * DAY - 1) }],
				NOW
			)
		).toBe(true);
	});

	// The window runs from what *they* sent. A reply of ours inside the window
	// does not reopen it, and an old inbound is still what closes it.
	it('measures from the last inbound message, not the last message', () => {
		expect(isMetaReplyWindowClosed('instagram', [inbound(9), outbound(1)], NOW)).toBe(true);
	});

	it('takes the newest inbound when there are several', () => {
		expect(isMetaReplyWindowClosed('instagram', [inbound(30), inbound(2)], NOW)).toBe(false);
	});

	// A conversation staff opened from the Instagram app: nobody has written to
	// us, so no window has started and there is nothing to block.
	it('does not block a thread with no inbound message', () => {
		expect(isMetaReplyWindowClosed('instagram', [outbound(30)], NOW)).toBe(false);
		expect(isMetaReplyWindowClosed('instagram', [], NOW)).toBe(false);
	});

	// False here means "nothing is stopping you", not "the window is open" —
	// email and SMS have no window, and a true would silence their composers.
	it.each(['email', 'sms', 'web', 'portal', 'direct'])('never blocks %s', (channel) => {
		expect(isMetaReplyWindowClosed(channel, [inbound(400)], NOW)).toBe(false);
	});

	it('accepts a serialized date, which is what crosses the remote boundary', () => {
		const serialized = [{ direction: 'inbound', createdAt: new Date(NOW - 9 * DAY).toISOString() }];
		expect(isMetaReplyWindowClosed('instagram', serialized, NOW)).toBe(true);
	});
});

describe('channel naming', () => {
	it('names the Meta channels', () => {
		expect(channelLabel('instagram')).toBe('Instagram');
		expect(channelLabel('messenger')).toBe('Messenger');
	});

	// An unknown channel must not blank the label or crash the icon: both are
	// rendered on every row of the queue.
	it('falls back rather than failing on an unknown channel', () => {
		expect(channelLabel('carrier-pigeon')).toBe('carrier-pigeon');
		expect(channelIcon('carrier-pigeon')).toBeDefined();
	});
});
