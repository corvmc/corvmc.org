import { describe, it, expect } from 'vitest';
import { inboxChannels, staffInboxChannels, alwaysEnabledInboxChannels } from '$lib/config';
import { inboxChannelMeta } from './inbox-channel-meta';

// The Inbox Channels tab reads `inboxChannelMeta[cfg.channel]` and then
// `.description` on it. `getAllChannelConfigs` synthesises a row for every
// channel in `staffInboxChannels`, so a channel there without a row here is a
// TypeError that blanks the entire settings page behind its error boundary —
// which is what `direct` did after #213 added it to `inboxChannels` and the
// service enumerated the whole vocabulary.

describe('inboxChannelMeta', () => {
	it('has an entry for every channel the settings page can be handed', () => {
		const missing = staffInboxChannels.filter((ch) => !(ch in inboxChannelMeta));
		expect(missing).toEqual([]);
	});

	it('describes every entry it has', () => {
		for (const meta of Object.values(inboxChannelMeta)) {
			expect(meta.description.length).toBeGreaterThan(0);
			expect(meta.envHint.length).toBeGreaterThan(0);
		}
	});

	it('has no entry for a channel the page is never handed', () => {
		const extra = Object.keys(inboxChannelMeta).filter(
			(ch) => !(staffInboxChannels as readonly string[]).includes(ch)
		);
		expect(extra).toEqual([]);
	});
});

describe('staffInboxChannels', () => {
	it('is a subset of the inbox_thread channel vocabulary', () => {
		const unknown = staffInboxChannels.filter(
			(ch) => !(inboxChannels as readonly string[]).includes(ch)
		);
		expect(unknown).toEqual([]);
	});

	it('excludes direct — member↔member threads have nothing staff configure', () => {
		expect(staffInboxChannels as readonly string[]).not.toContain('direct');
	});

	it('excludes band — a booking enquiry belongs to the act, not to us', () => {
		expect(staffInboxChannels as readonly string[]).not.toContain('band');
	});

	it('covers every channel except the two staff are not party to', () => {
		expect([...staffInboxChannels]).toEqual(
			inboxChannels.filter((ch) => ch !== 'direct' && ch !== 'band')
		);
	});

	/**
	 * `band` is the one channel that is always enabled *and* deliberately absent
	 * from the tab, which reads as a contradiction and is not: always-enabled is
	 * about whether `dispatchReply` may send on it (it must, or a band's reply
	 * never reaches the booker), and this list is about who administers it.
	 *
	 * Pinned so that nobody reconciles the two by adding `band` here — which
	 * would put an act's booking queue in Staff Settings — or by taking it out of
	 * `alwaysEnabledInboxChannels`, which would stop band replies from sending.
	 */
	it('leaves band always-enabled but unadministered', () => {
		expect(alwaysEnabledInboxChannels as readonly string[]).toContain('band');
		expect(staffInboxChannels as readonly string[]).not.toContain('band');
	});

	it('includes the always-enabled channels it does administer, rendered as Always On', () => {
		const administered = alwaysEnabledInboxChannels.filter((ch) => ch !== 'band');
		for (const ch of administered) {
			expect(staffInboxChannels as readonly string[]).toContain(ch);
		}
	});
});
