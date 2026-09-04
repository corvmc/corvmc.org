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

	it('covers every channel except direct', () => {
		expect([...staffInboxChannels]).toEqual(inboxChannels.filter((ch) => ch !== 'direct'));
	});

	it('includes the always-enabled channels, which the tab renders as Always On', () => {
		for (const ch of alwaysEnabledInboxChannels) {
			expect(staffInboxChannels as readonly string[]).toContain(ch);
		}
	});
});
