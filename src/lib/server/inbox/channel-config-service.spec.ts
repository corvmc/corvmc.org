import { describe, it, expect, vi, beforeEach } from 'vitest';

// The channel toggles are a staff setting backed by one row per channel. Two
// channels have no external system behind them — the public contact form and
// the member portal both deliver through the site itself — so there is nothing
// to authenticate and nothing to turn off. These tests pin that "always on"
// really is unconditional: a stale disabled row must not be able to break
// replies on either of them.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { getAllChannelConfigs, getChannelConfig, isChannelEnabled, updateChannelConfig } =
	await import('./channel-config-service');

const rows = () =>
	sqlite.prepare('select channel, enabled from inbox_channel_config order by channel').all();
const seed = (channel: string, enabled: boolean) =>
	sqlite
		.prepare('insert into inbox_channel_config (id, channel, enabled) values (?, ?, ?)')
		.run(`cfg-${channel}`, channel, enabled ? 1 : 0);

beforeEach(() => {
	sqlite.exec('delete from inbox_channel_config');
});

describe.each(['web', 'portal'] as const)('always-enabled channel: %s', (channel) => {
	it('is enabled with no config row at all', async () => {
		expect(await isChannelEnabled(channel)).toBe(true);
		expect((await getChannelConfig(channel)).enabled).toBe(true);
	});

	it('is enabled even when a row says otherwise', async () => {
		seed(channel, false);

		expect(await isChannelEnabled(channel)).toBe(true);
		const all = await getAllChannelConfigs();
		expect(all.find((c) => c.channel === channel)?.enabled).toBe(true);
	});

	it('cannot be toggled off', async () => {
		// Writing the row anyway would store a flag every read ignores, which
		// reads as a bug the next time someone debugs a channel.
		await updateChannelConfig(channel, false);

		expect(rows()).toEqual([]);
	});
});

describe('configurable channels', () => {
	it('default to disabled when no row exists', async () => {
		expect(await isChannelEnabled('email')).toBe(false);
		expect(await isChannelEnabled('sms')).toBe(false);
	});

	it('read their own row, not another channel’s', async () => {
		seed('sms', true);

		expect(await isChannelEnabled('sms')).toBe(true);
		expect(await isChannelEnabled('email')).toBe(false);
	});

	it('are still writable', async () => {
		await updateChannelConfig('email', true);
		expect(rows()).toEqual([{ channel: 'email', enabled: 1 }]);
	});

	it('update the existing row rather than adding a second', async () => {
		seed('email', true);
		await updateChannelConfig('email', false);

		expect(rows()).toEqual([{ channel: 'email', enabled: 0 }]);
	});
});
