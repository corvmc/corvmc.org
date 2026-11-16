import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPracticeSpaceSettingsPage } from '#lib/remote/settings.remote.js';
import { getBuildingAccess } from '#lib/remote/lock.remote.js';
import { visibleViews } from '../../views';
import { settingsViews } from './views';

// Building access is a settings tab (#3102) that keeps `lock.manage` as its only
// gate: the tab hides, and each remote refuses, by its own capability.
const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('#lib/server/authorization.js', async (original) => ({
	...(await original<typeof import('#lib/server/authorization.js')>()),
	...(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock()
);

const SETTINGS = 'settings.read';
const LOCK = 'lock.manage';

beforeEach(() => {
	auth.held = [];
});

describe('tabs', () => {
	it.each([
		[
			[SETTINGS, LOCK],
			['booking', 'building-access']
		],
		[[SETTINGS], ['booking']],
		[[LOCK], ['building-access']],
		[[], []]
	])('holding %j shows %j', (held, keys) => {
		expect(visibleViews(settingsViews, held).map((v) => v.key)).toEqual(keys);
	});

	it('loads no settings.read query on the Building access tab', () => {
		const page = readFileSync(new URL('./building-access/+page.svelte', import.meta.url), 'utf8');
		expect(page).not.toContain('getPracticeSpaceSettingsPage');
	});
});

describe('remotes', () => {
	it('refuses the booking tab to someone holding only lock.manage', async () => {
		auth.held = [LOCK];
		await expect((getPracticeSpaceSettingsPage as never as () => unknown)()).rejects.toMatchObject({
			status: 403
		});
	});

	it('refuses Building access to someone holding only settings.read', async () => {
		auth.held = [SETTINGS];
		await expect((getBuildingAccess as never as () => unknown)()).rejects.toMatchObject({
			status: 403
		});
	});
});
