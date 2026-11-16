import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Which event may move which send is a WHERE clause, so this runs on a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { recordSendEvent, listCampaignSends } = await import('./campaign-send-service');

function send(id: string, status: string, email = `${id}@example.com`) {
	sqlite
		.prepare(
			`insert into campaign_send (id, campaign_id, audience_id, email, status, provider_message_id)
			 values (?, 'camp-1', 'aud-1', ?, ?, ?)`
		)
		.run(id, email, status, `pm-${id}`);
}
const statusOf = (id: string) =>
	(sqlite.prepare('select status from campaign_send where id = ?').get(id) as { status: string })
		.status;

beforeEach(() => {
	sqlite.exec('delete from campaign_send');
	sqlite.exec('delete from campaign');
	sqlite.exec('delete from audience');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values ('u1', 'u1', 'u1@x.test', 1)`
	);
	sqlite.exec(
		`insert into campaign (id, subject, markdown_body, html_body, sent_by_id) values ('camp-1', 'Hi', '', '', 'u1')`
	);
	sqlite.exec(`insert into audience (id, name, slug) values ('aud-1', 'Newsletter', 'newsletter')`);
});

describe('a Postmark event on a campaign send', () => {
	it('marks a sent message delivered, bounced or complained', async () => {
		send('a', 'sent');
		send('b', 'sent');
		send('c', 'sent');

		await recordSendEvent('pm-a', 'delivered');
		await recordSendEvent('pm-b', 'bounced');
		await recordSendEvent('pm-c', 'complained');

		expect([statusOf('a'), statusOf('b'), statusOf('c')]).toEqual([
			'delivered',
			'bounced',
			'complained'
		]);
	});

	it('never moves a complaint, or a message that failed to send', async () => {
		send('a', 'complained');
		send('b', 'failed');

		expect(await recordSendEvent('pm-a', 'delivered')).toBe(false);
		expect(await recordSendEvent('pm-b', 'delivered')).toBe(false);
		expect([statusOf('a'), statusOf('b')]).toEqual(['complained', 'failed']);
	});

	it('lets a late delivery correct a soft bounce', async () => {
		send('a', 'bounced');

		await recordSendEvent('pm-a', 'delivered');

		expect(statusOf('a')).toBe('delivered');
	});

	it('matches nothing for a message that is not a campaign send', async () => {
		expect(await recordSendEvent('pm-unknown', 'bounced')).toBe(false);
	});
});

describe('the campaign page list', () => {
	it('puts problems first and counts each status', async () => {
		send('a', 'delivered', 'a@example.com');
		send('b', 'failed', 'b@example.com');
		send('c', 'delivered', 'c@example.com');

		const { rows, counts } = await listCampaignSends('camp-1');

		expect(rows.map((r) => r.email)).toEqual(['b@example.com', 'a@example.com', 'c@example.com']);
		expect(rows[0]).toMatchObject({ audience: 'Newsletter' });
		expect(counts).toEqual({ delivered: 2, failed: 1 });
	});
});
