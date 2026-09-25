import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));

const sendTemplateBatch = vi.fn(async () => undefined);
vi.mock('$lib/server/notification/email', () => ({
	sendTemplateBatch: (...a: unknown[]) => sendTemplateBatch(...(a as []))
}));
vi.mock('$lib/server/notification/sse', () => ({ pushToUser: vi.fn() }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const { fanOutBallotNotice } = await import('./ballot-fanout');
const { user } = await import('$lib/server/db/schema/authentication');
const { notification, notificationPreference } = await import('$lib/server/db/schema/notification');
const { ballot, ballotElector } = await import('$lib/server/db/schema/ballot');

const BALLOT = 'bal-1';
const event = { ballotId: BALLOT, title: 'Adopt the bylaws' };

beforeEach(async () => {
	sendTemplateBatch.mockClear();
	for (const t of ['notification', 'notification_preference', 'ballot_elector', 'ballot', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	await testDb.insert(user).values([
		{ id: 'u-elector', name: 'Ada Voter', email: 'ada@example.com', emailVerified: true },
		{ id: 'u-other', name: 'Bo Member', email: 'bo@example.com', emailVerified: true },
		{
			id: 'u-banned',
			name: 'Cy Banned',
			email: 'cy@example.com',
			emailVerified: true,
			deletedAt: new Date(),
			bannedAt: new Date()
		}
	] as never);
	await testDb.insert(ballot).values({
		id: BALLOT,
		kind: 'member',
		title: event.title,
		closesAt: new Date(Date.now() + 86_400_000),
		openedAt: new Date()
	});
	await testDb.insert(ballotElector).values([
		{ ballotId: BALLOT, userId: 'u-elector' },
		{ ballotId: BALLOT, userId: 'u-banned' }
	]);
});

async function notified() {
	return (await testDb.select({ userId: notification.userId }).from(notification))
		.map((r) => r.userId)
		.sort();
}

describe('the open notice', () => {
	it('reaches active electors only, in-app and by email', async () => {
		await fanOutBallotNotice('ballot_opened', event, 'https://x.test');
		expect(await notified()).toEqual(['u-elector']);
		expect(sendTemplateBatch).toHaveBeenCalledWith(
			'notification',
			[expect.objectContaining({ to: 'ada@example.com' })],
			{ tag: 'ballot_opened' }
		);
	});

	it('sends once however many times the event is delivered', async () => {
		await fanOutBallotNotice('ballot_opened', event, 'https://x.test');
		await fanOutBallotNotice('ballot_opened', event, 'https://x.test');
		expect(await notified()).toEqual(['u-elector']);
	});
});

describe('the result notice', () => {
	it('reaches every active account in-app, and emails nobody by default', async () => {
		await fanOutBallotNotice('ballot_result', event, 'https://x.test');
		expect(await notified()).toEqual(['u-elector', 'u-other']);
		expect(sendTemplateBatch).not.toHaveBeenCalled();
	});

	it('honours a member who turned it off', async () => {
		await testDb.insert(notificationPreference).values({
			userId: 'u-other',
			notificationType: 'ballot_result',
			inAppEnabled: false,
			emailEnabled: false
		} as never);
		await fanOutBallotNotice('ballot_result', event, 'https://x.test');
		expect(await notified()).toEqual(['u-elector']);
	});
});
