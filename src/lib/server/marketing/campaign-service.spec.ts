import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Campaigns against a real SQLite with the real built-in resolver: who gets a
// blast is a set of joins. Postmark, the token signer and sponsor credits stay
// mocked; the renderer is spied on for the markdown it is handed.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

vi.mock('./campaign-render', () => ({
	renderCampaignPreview: vi.fn(() => '<html>preview</html>'),
	renderCampaignForSend: vi.fn(() => '<html>send</html>')
}));
vi.mock('#lib/server/sponsor/credit-service.js', () => ({
	creditsForEvent: vi.fn(async () => [])
}));
vi.mock('./unsubscribe', () => ({ signUnsubscribeToken: vi.fn(() => 'unsub-token') }));
vi.mock('#lib/server/notification/email/index.js', () => ({
	sendBroadcastBatch: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$env/dynamic/private', () => ({ env: { PUBLIC_SITE_URL: 'https://test.com' } }));

const { sendBroadcastBatch } = await import('#lib/server/notification/email/index.js');
const { creditsForEvent } = await import('#lib/server/sponsor/credit-service.js');
const { renderCampaignForSend, renderCampaignPreview } = await import('./campaign-render');
const { signUnsubscribeToken } = await import('./unsubscribe');
const {
	deriveCampaignStatus,
	createCampaign,
	updateCampaign,
	deleteCampaign,
	scheduleCampaign,
	sendNow,
	executeSend,
	processDueCampaigns,
	CampaignNotFoundError,
	CampaignValidationError,
	CampaignStateError
} = await import('./campaign-service');

const NOW = new Date('2026-06-15T12:00:00Z');
const NOW_S = NOW.getTime() / 1000;
const HOUR = 3600;

function camp(
	id: string,
	opts: { scheduledFor?: number; sentAt?: number; eventId?: string; subject?: string } = {}
) {
	sqlite
		.prepare(
			`insert into campaign (id, subject, markdown_body, html_body, sent_by_id, scheduled_for, sent_at, event_id, created_at, updated_at)
			 values (?, ?, '# Hello', '<h1>Hello</h1>', 'user-1', ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			opts.subject ?? 'Hello World',
			opts.scheduledFor ?? null,
			opts.sentAt ?? null,
			opts.eventId ?? null,
			NOW_S - HOUR,
			NOW_S - HOUR
		);
}

function aud(id: string, systemKey: string | null = null) {
	sqlite
		.prepare(`insert into audience (id, name, slug, system_key) values (?, ?, ?, ?)`)
		.run(id, id, systemKey ?? id, systemKey);
}

function target(campaignId: string, ...audienceIds: string[]) {
	for (const a of audienceIds) {
		sqlite
			.prepare(`insert into campaign_audience (campaign_id, audience_id) values (?, ?)`)
			.run(campaignId, a);
	}
}

function sub(id: string, email: string, opts: { userId?: string; suppressedAt?: number } = {}) {
	sqlite
		.prepare(
			`insert into subscriber (id, email, name, user_id, suppressed_at) values (?, ?, ?, ?, ?)`
		)
		.run(id, email, `Name ${id}`, opts.userId ?? null, opts.suppressedAt ?? null);
}

function member(audienceId: string, subscriberId: string, unsubscribedAt?: number) {
	sqlite
		.prepare(
			`insert into audience_member (audience_id, subscriber_id, unsubscribed_at) values (?, ?, ?)`
		)
		.run(audienceId, subscriberId, unsubscribedAt ?? null);
}

function account(id: string, email: string) {
	sqlite
		.prepare(`insert into user (id, name, email, email_verified) values (?, ?, ?, 1)`)
		.run(id, id, email);
}

const campRow = (id: string) =>
	sqlite.prepare('select * from campaign where id = ?').get(id) as
		| {
				subject: string;
				scheduled_for: number | null;
				sent_at: number | null;
				recipient_count: number | null;
		  }
		| undefined;
const links = (campaignId: string) =>
	(
		sqlite
			.prepare(
				'select audience_id from campaign_audience where campaign_id = ? order by audience_id'
			)
			.all(campaignId) as { audience_id: string }[]
	).map((r) => r.audience_id);
const sentTo = () => vi.mocked(sendBroadcastBatch).mock.calls.flatMap(([m]) => m.map((x) => x.to));

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	for (const t of [
		'campaign_audience',
		'campaign',
		'audience_member',
		'subscriber',
		'audience',
		'event_rsvp',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	aud('aud-1');
	aud('aud-2');
});

afterEach(() => {
	vi.useRealTimers();
});

describe('deriveCampaignStatus', () => {
	it('returns "sent" when sentAt is set, regardless of scheduledFor', () => {
		expect(deriveCampaignStatus(null, NOW)).toBe('sent');
		expect(deriveCampaignStatus(NOW, NOW)).toBe('sent');
	});

	it('returns "draft" when sentAt is null and scheduledFor is null', () => {
		expect(deriveCampaignStatus(null, null)).toBe('draft');
	});

	it('returns "scheduled" when scheduledFor is in the future', () => {
		expect(deriveCampaignStatus(new Date(NOW.getTime() + 60_000), null)).toBe('scheduled');
	});

	it('returns "sending" when scheduledFor is in the past and sentAt is null', () => {
		expect(deriveCampaignStatus(new Date(NOW.getTime() - 60_000), null)).toBe('sending');
	});
});

describe('createCampaign', () => {
	const base = { subject: 'Hello', markdownBody: '# Hi', sentById: 'user-1' };

	it('throws when subject exceeds 500 characters', async () => {
		await expect(
			createCampaign({ ...base, subject: 'x'.repeat(501), audienceIds: ['aud-1'] })
		).rejects.toThrow(CampaignValidationError);
	});

	it('throws when audienceIds is empty', async () => {
		await expect(createCampaign({ ...base, audienceIds: [] })).rejects.toThrow(
			CampaignValidationError
		);
	});

	it('throws when more than 20 audiences are provided', async () => {
		const ids = Array.from({ length: 21 }, (_, i) => `aud-${i}`);
		await expect(createCampaign({ ...base, audienceIds: ids })).rejects.toThrow(
			CampaignValidationError
		);
	});

	it("previews the credit for a show's sponsors", async () => {
		vi.mocked(creditsForEvent).mockResolvedValueOnce([
			{ sponsorId: 's1', name: 'Block 15', website: null, logoKey: null }
		]);

		await createCampaign({ ...base, audienceIds: ['aud-1'], eventId: 'evt-1' });

		expect(vi.mocked(renderCampaignPreview).mock.calls[0][0]).toContain('Sponsored by Block 15.');
	});

	it('inserts the campaign row and its audience links', async () => {
		const result = await createCampaign({ ...base, audienceIds: ['aud-1', 'aud-2'] });

		expect(campRow(result.id)?.subject).toBe('Hello');
		expect(links(result.id)).toEqual(['aud-1', 'aud-2']);
	});
});

describe('updateCampaign', () => {
	it('throws when campaign is not found', async () => {
		await expect(updateCampaign('camp-999', { subject: 'New' })).rejects.toThrow(
			CampaignNotFoundError
		);
	});

	it('throws when campaign is sent (non-draft)', async () => {
		camp('camp-1', { sentAt: NOW_S - 60 });
		await expect(updateCampaign('camp-1', { subject: 'New' })).rejects.toThrow(CampaignStateError);
		expect(campRow('camp-1')?.subject).toBe('Hello World');
	});

	it('throws when campaign is scheduled (non-draft)', async () => {
		camp('camp-1', { scheduledFor: NOW_S + 60 });
		await expect(updateCampaign('camp-1', { subject: 'New' })).rejects.toThrow(CampaignStateError);
	});

	it('validates subject length on update', async () => {
		camp('camp-1');
		await expect(updateCampaign('camp-1', { subject: 'x'.repeat(501) })).rejects.toThrow(
			CampaignValidationError
		);
	});

	it('validates audienceIds not empty on update', async () => {
		camp('camp-1');
		await expect(updateCampaign('camp-1', { audienceIds: [] })).rejects.toThrow(
			CampaignValidationError
		);
	});

	it('replaces audience links when audienceIds are provided, and only this campaign’s', async () => {
		camp('camp-1');
		camp('camp-2');
		target('camp-1', 'aud-1', 'aud-2');
		target('camp-2', 'aud-1');

		await updateCampaign('camp-1', { audienceIds: ['aud-3'] });

		expect(links('camp-1')).toEqual(['aud-3']);
		expect(links('camp-2')).toEqual(['aud-1']);
	});
});

describe('deleteCampaign', () => {
	it('throws when campaign is not found', async () => {
		await expect(deleteCampaign('camp-999')).rejects.toThrow(CampaignNotFoundError);
	});

	it('throws when campaign is not in draft status', async () => {
		camp('camp-1', { sentAt: NOW_S - 60 });
		await expect(deleteCampaign('camp-1')).rejects.toThrow(CampaignStateError);
		expect(campRow('camp-1')).toBeDefined();
	});

	it('deletes a draft campaign', async () => {
		camp('camp-1');
		camp('camp-2');

		await deleteCampaign('camp-1');

		expect(campRow('camp-1')).toBeUndefined();
		expect(campRow('camp-2')).toBeDefined();
	});
});

describe('scheduleCampaign', () => {
	const future = new Date(NOW.getTime() + 60_000);

	it('throws when campaign is not in draft status', async () => {
		camp('camp-1', { sentAt: NOW_S - 60 });
		await expect(scheduleCampaign('camp-1', future)).rejects.toThrow(CampaignStateError);
	});

	it('throws when scheduledFor is in the past', async () => {
		camp('camp-1');
		await expect(scheduleCampaign('camp-1', new Date(NOW.getTime() - 60_000))).rejects.toThrow(
			CampaignValidationError
		);
	});

	it('sets scheduledFor on a draft campaign', async () => {
		camp('camp-1');

		await scheduleCampaign('camp-1', future);

		expect(campRow('camp-1')?.scheduled_for).toBe(future.getTime() / 1000);
	});
});

describe('sendNow', () => {
	it('throws when campaign is not in draft status', async () => {
		camp('camp-1', { sentAt: NOW_S - 60 });
		await expect(sendNow('camp-1')).rejects.toThrow(CampaignStateError);
	});

	it('sends a draft campaign inline and marks it sent', async () => {
		camp('camp-1');
		target('camp-1', 'aud-1');
		sub('sub-1', 'member@example.com');
		member('aud-1', 'sub-1');

		await sendNow('camp-1');

		expect(sentTo()).toEqual(['member@example.com']);
		expect(campRow('camp-1')).toMatchObject({
			scheduled_for: NOW_S,
			sent_at: NOW_S,
			recipient_count: 1
		});
	});
});

describe('executeSend', () => {
	it('throws when campaign is not found', async () => {
		await expect(executeSend('camp-999')).rejects.toThrow(CampaignNotFoundError);
	});

	it('throws when campaign is already sent', async () => {
		camp('camp-1', { sentAt: NOW_S - 60 });
		await expect(executeSend('camp-1')).rejects.toThrow(CampaignStateError);
		expect(sendBroadcastBatch).not.toHaveBeenCalled();
	});

	it('returns 0 and marks campaign sent with recipientCount 0 when no recipients', async () => {
		camp('camp-1');

		expect(await executeSend('camp-1')).toBe(0);

		expect(sendBroadcastBatch).not.toHaveBeenCalled();
		expect(campRow('camp-1')).toMatchObject({ sent_at: NOW_S, recipient_count: 0 });
	});

	it("credits the show's sponsors below the body it sends (#583)", async () => {
		vi.mocked(creditsForEvent).mockResolvedValueOnce([
			{ sponsorId: 's1', name: 'Troubadour Music', website: null, logoKey: null }
		]);
		camp('camp-1', { eventId: 'evt-1' });
		target('camp-1', 'aud-1');
		sub('sub-1', 'member@example.com');
		member('aud-1', 'sub-1');

		await executeSend('camp-1');

		expect(creditsForEvent).toHaveBeenCalledWith('evt-1', 'campaign');
		const [markdown] = vi.mocked(renderCampaignForSend).mock.calls[0];
		expect(markdown).toContain('# Hello');
		expect(markdown).toContain('Sponsored by Troubadour Music.');
	});

	it('looks up no sponsors for a blast about no show', async () => {
		camp('camp-1');
		target('camp-1', 'aud-1');
		sub('sub-1', 'member@example.com');
		member('aud-1', 'sub-1');

		await executeSend('camp-1');

		expect(creditsForEvent).not.toHaveBeenCalled();
		expect(vi.mocked(renderCampaignForSend).mock.calls[0][0]).toBe('# Hello');
	});

	it('sends one message per recipient, with one-click unsubscribe headers', async () => {
		camp('camp-1');
		target('camp-1', 'aud-1');
		sub('sub-1', 'member@example.com');
		member('aud-1', 'sub-1');

		expect(await executeSend('camp-1')).toBe(1);

		expect(sendBroadcastBatch).toHaveBeenCalledOnce();
		const [messages] = vi.mocked(sendBroadcastBatch).mock.calls[0];
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			to: 'member@example.com',
			subject: 'Hello World',
			tag: 'campaign'
		});
		// RFC 8058
		expect(messages[0].headers).toEqual([
			{ Name: 'List-Unsubscribe', Value: '<https://test.com/unsubscribe/unsub-token>' },
			{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
		]);
	});

	it('leaves out suppressed, unsubscribed and untargeted subscribers', async () => {
		aud('aud-other');
		camp('camp-1');
		target('camp-1', 'aud-1');
		sub('sub-ok', 'ok@example.com');
		sub('sub-supp', 'supp@example.com', { suppressedAt: NOW_S - HOUR });
		sub('sub-unsub', 'unsub@example.com');
		sub('sub-else', 'else@example.com');
		member('aud-1', 'sub-ok');
		member('aud-1', 'sub-supp');
		member('aud-1', 'sub-unsub', NOW_S - HOUR);
		member('aud-other', 'sub-else');

		expect(await executeSend('camp-1')).toBe(1);
		expect(sentTo()).toEqual(['ok@example.com']);
	});

	// Regression: a subscriber in two of the campaign's audiences used to get
	// one copy per audience. Built-ins overlap every static list.
	it('sends exactly one message to a subscriber who is in two targeted audiences', async () => {
		camp('camp-1');
		target('camp-1', 'aud-1', 'aud-2');
		sub('sub-1', 'member@example.com');
		member('aud-1', 'sub-1');
		member('aud-2', 'sub-1');

		expect(await executeSend('camp-1')).toBe(1);
		expect(sentTo()).toEqual(['member@example.com']);
	});

	it('sends one message when a member is in both a built-in and a static audience', async () => {
		aud('aud-system', 'all-members');
		camp('camp-1');
		target('camp-1', 'aud-1', 'aud-system');
		account('user-1', 'member@example.com');
		sub('sub-1', 'member@example.com', { userId: 'user-1' });
		member('aud-1', 'sub-1');

		expect(await executeSend('camp-1')).toBe(1);
		expect(sentTo()).toEqual(['member@example.com']);
	});

	it('reaches members of a built-in audience who never subscribed to anything', async () => {
		aud('aud-system', 'all-members');
		camp('camp-1');
		target('camp-1', 'aud-system');
		account('user-1', 'member@example.com');

		expect(await executeSend('camp-1')).toBe(1);
		expect(sentTo()).toEqual(['member@example.com']);
	});

	// #857: the event audience is the one built-in whose membership depends on
	// the campaign, so the campaign's show has to reach the resolver.
	it("resolves the event audience against the campaign's show", async () => {
		aud('aud-event', 'event-interest');
		camp('camp-1', { eventId: 'evt-9' });
		target('camp-1', 'aud-event');
		account('user-1', 'going@example.com');
		account('user-2', 'elsewhere@example.com');
		const rsvp = sqlite.prepare(
			`insert into event_rsvp (event_id, user_id, attendee_name, attendee_email) values (?, ?, 'x', 'x@example.com')`
		);
		rsvp.run('evt-9', 'user-1');
		rsvp.run('evt-other', 'user-2');

		await executeSend('camp-1');

		expect(sentTo()).toEqual(['going@example.com']);
	});

	it('scopes a deduplicated recipient to a deterministic audience', async () => {
		// The retained audienceId scopes the unsubscribe token, so it must not
		// depend on row order coming back from the database.
		camp('camp-1');
		target('camp-1', 'aud-2', 'aud-1');
		sub('sub-1', 'member@example.com');
		member('aud-2', 'sub-1');
		member('aud-1', 'sub-1');

		await executeSend('camp-1');

		expect(signUnsubscribeToken).toHaveBeenCalledWith('sub-1', 'aud-1');
	});

	// #988: a mid-batch Postmark failure had left the row matching
	// processDueCampaigns' predicate, so the cron re-sent to the whole list.
	it('marks the campaign sent before the batch, so a failed send is never re-queued', async () => {
		camp('camp-1', { scheduledFor: NOW_S - 60 });
		target('camp-1', 'aud-1');
		sub('sub-1', 'member@example.com');
		member('aud-1', 'sub-1');
		vi.mocked(sendBroadcastBatch).mockRejectedValueOnce(new Error('Postmark 500'));

		await expect(executeSend('camp-1')).rejects.toThrow('Postmark 500');

		expect(campRow('camp-1')).toMatchObject({ sent_at: NOW_S, recipient_count: 1 });
		expect(await processDueCampaigns()).toBe(0);
	});

	it('builds unsubscribe URL from env.PUBLIC_SITE_URL and renders per-recipient HTML', async () => {
		camp('camp-1');
		target('camp-1', 'aud-1');
		sub('sub-1', 'member@example.com');
		member('aud-1', 'sub-1');

		await executeSend('camp-1');

		expect(signUnsubscribeToken).toHaveBeenCalledWith('sub-1', 'aud-1');
		expect(renderCampaignForSend).toHaveBeenCalledWith(
			'# Hello',
			'Name sub-1',
			'https://test.com/unsubscribe/unsub-token'
		);
	});
});

describe('processDueCampaigns', () => {
	it('sends only campaigns that are due and unsent', async () => {
		camp('due', { scheduledFor: NOW_S - 60 });
		camp('later', { scheduledFor: NOW_S + HOUR });
		camp('draft');
		camp('done', { scheduledFor: NOW_S - HOUR, sentAt: NOW_S - 60 });

		expect(await processDueCampaigns()).toBe(1);

		expect(campRow('due')?.sent_at).toBe(NOW_S);
		expect(campRow('later')?.sent_at).toBeNull();
		expect(campRow('draft')?.sent_at).toBeNull();
	});
});
