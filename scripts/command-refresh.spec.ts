import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A `form()` refreshes every query on the page after it succeeds; a
 * `command()` refreshes nothing. A command that changes a record a page is
 * already holding leaves that page on its cached copy until a reload: a
 * scheduled campaign kept showing as a draft (#2774). Each command refreshes
 * (or `.set()`s) what it changed, or is listed below as changing nothing a
 * page holds.
 */
const REMOTE_GLOB = ['src/lib/remote/*.remote.ts'];

/**
 * As `file:command`. A list rather than a count, so two PRs editing it
 * conflict in git instead of silently disagreeing.
 */
const REFRESHES_NOTHING = new Set([
	// Present when this spec landed and not reviewed one by one.
	'billing.remote.ts:startAddCard',
	'billing.remote.ts:startBandAddCard',
	'door.remote.ts:getTerminalConnection',
	'door.remote.ts:cancelDoorSale',
	'door.remote.ts:simulateDoorTap',
	'event-poster.remote.ts:printEventPoster',
	'inbox.remote.ts:testMetaConnection',
	'lock.remote.ts:runLockJobNow',
	'lock.remote.ts:retryDoorCodes',
	'lock.remote.ts:rotateFallbackCode',
	'lock.remote.ts:adoptUnmanagedCode',
	'lock.remote.ts:grantStandingCode',
	'lock.remote.ts:revokeStandingCode',
	// Create a record no query holds yet, then navigate to it.
	'marketing.remote.ts:createDraft',
	'marketing.remote.ts:createAndSend',
	'marketing.remote.ts:createAndSchedule',
	// The editor navigates to the list, which loads fresh.
	'marketing.remote.ts:deleteCampaign',
	// Writes only an outbox row, which no page reads.
	'marketing.remote.ts:sendTestCampaign',
	// Present when this spec landed and not reviewed one by one.
	'notifications.remote.ts:markNotificationRead',
	'notifications.remote.ts:markAllNotificationsRead',
	'reservations.remote.ts:payAtReader',
	'reservations.remote.ts:cancelPayAtReader',
	'reservations.remote.ts:simulatePayAtReader',
	'settings.remote.ts:runLockSelfTest',
	'settings.remote.ts:revokeLockTest',
	'settings.remote.ts:syncSubscriptions',
	'settings.remote.ts:refreshCommunityStats',
	'tasks.remote.ts:reorderSectionsCommand'
]);

/** Each exported `command(...)` with its text, up to the next export. */
function commands(file: string): { key: string; body: string }[] {
	const source = readFileSync(file, 'utf8');
	const exports = [...source.matchAll(/^export /gm)].map((m) => m.index);
	const base = file.split('/').pop();
	return [...source.matchAll(/^export const (\w+) = command\(/gm)].map((m) => ({
		key: `${base}:${m[1]}`,
		body: source.slice(m.index, exports.find((at) => at > m.index) ?? source.length)
	}));
}

describe('remote commands', () => {
	const all = sourceFiles(REMOTE_GLOB, new Set()).flatMap(commands);

	it('refresh what they change, or are listed as changing nothing a page holds', () => {
		const silent = all
			.filter(({ key, body }) => !REFRESHES_NOTHING.has(key) && !/\.(refresh|set)\(/.test(body))
			.map(({ key }) => key);

		expect(silent).toEqual([]);
	});

	it('list only commands that still exist and still refresh nothing', () => {
		const stale = [...REFRESHES_NOTHING].filter((key) => {
			const found = all.find((c) => c.key === key);
			return !found || /\.(refresh|set)\(/.test(found.body);
		});

		expect(stale).toEqual([]);
	});
});
