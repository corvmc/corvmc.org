import { describe, it, expect } from 'vitest';
import { buildIcsFeed, buildRssFeed, type FeedEvent } from './calendar-feed';

const NOW = new Date('2026-09-23T12:00:00Z');
const ORIGIN = 'https://corvmc.org';

function row(overrides: Partial<FeedEvent> = {}): FeedEvent {
	return {
		id: 'evt-1',
		title: 'Paper Wolves, Bombs Away',
		description: null,
		location: 'Bombs Away Cafe',
		startsAt: new Date('2026-10-01T03:00:00Z'),
		endsAt: new Date('2026-10-01T06:00:00Z'),
		status: 'published',
		updatedAt: new Date('2026-09-20T00:00:00Z'),
		...overrides
	};
}

/** Unfolded content lines, so assertions do not depend on where a line wraps. */
function lines(ics: string): string[] {
	return ics.replace(/\r\n[ \t]/g, '').split('\r\n');
}

describe('buildIcsFeed', () => {
	it('emits one VEVENT per listing inside a single calendar', () => {
		const ics = lines(buildIcsFeed([row(), row({ id: 'evt-2' })], { origin: ORIGIN, now: NOW }));
		expect(ics[0]).toBe('BEGIN:VCALENDAR');
		expect(ics.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
	});

	it('uses the same UID as the per-event download, so the two never duplicate', () => {
		const ics = lines(buildIcsFeed([row()], { origin: ORIGIN, now: NOW }));
		expect(ics).toContain('UID:evt-1@corvmc.org');
	});

	it('marks a cancelled show CANCELLED rather than dropping it', () => {
		const ics = lines(buildIcsFeed([row({ status: 'cancelled' })], { origin: ORIGIN, now: NOW }));
		expect(ics).toContain('STATUS:CANCELLED');
	});

	it('assumes a two-hour set when the end is unknown', () => {
		const ics = lines(buildIcsFeed([row({ endsAt: null })], { origin: ORIGIN, now: NOW }));
		expect(ics).toContain('DTEND:20261001T050000Z');
	});

	it('links each entry to its public page', () => {
		const ics = lines(buildIcsFeed([row()], { origin: ORIGIN, now: NOW }));
		expect(
			ics.some((l) => l.startsWith('URL') && l.endsWith('https://corvmc.org/events/evt-1'))
		).toBe(true);
	});

	it('flattens a rich-text description to plain text', () => {
		const ics = lines(
			buildIcsFeed([row({ description: '<p>All ages &amp; <strong>free</strong></p>' })], {
				origin: ORIGIN,
				now: NOW
			})
		);
		expect(ics).toContain('DESCRIPTION:All ages & free');
	});
});

describe('buildRssFeed', () => {
	it('emits an item per listing, linked to its page', () => {
		const xml = buildRssFeed([row(), row({ id: 'evt-2', title: 'Open Mic' })], {
			origin: ORIGIN,
			now: NOW
		});
		expect(xml).toContain('<rss');
		expect(xml.match(/<item>/g)).toHaveLength(2);
		expect(xml).toContain('<link>https://corvmc.org/events/evt-2</link>');
	});

	it('says in the title when the show is and whether it is off', () => {
		const xml = buildRssFeed([row({ status: 'cancelled' })], { origin: ORIGIN, now: NOW });
		// 03:00Z on Oct 1 is 8 PM on Sep 30 in Corvallis.
		expect(xml).toMatch(/Cancelled: Paper Wolves, Bombs Away — Wed, Sep 30/);
	});
});
