import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — all vi.mock factories must not reference top-level variables
// ---------------------------------------------------------------------------

vi.mock('$lib/server/db', () => {
	const db = {
		select: vi.fn(),
		selectDistinct: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	};

	return { db };
});

vi.mock('$lib/server/db/schema/marketing', () => ({
	campaign: {
		id: 'campaign.id',
		scheduledFor: 'campaign.scheduledFor',
		sentAt: 'campaign.sentAt'
	},
	campaignAudience: {
		campaignId: 'campaignAudience.campaignId',
		audienceId: 'campaignAudience.audienceId'
	},
	audience: { id: 'audience.id', name: 'audience.name', systemKey: 'audience.systemKey' },
	audienceMember: {
		audienceId: 'audienceMember.audienceId',
		subscriberId: 'audienceMember.subscriberId',
		unsubscribedAt: 'audienceMember.unsubscribedAt'
	},
	subscriber: {
		id: 'subscriber.id',
		email: 'subscriber.email',
		name: 'subscriber.name',
		suppressedAt: 'subscriber.suppressedAt'
	}
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'eq' })),
	and: vi.fn((...args: unknown[]) => ({ args, op: 'and' })),
	sql: vi.fn((strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals, op: 'sql' })),
	isNull: vi.fn((col: unknown) => ({ col, op: 'isNull' })),
	lte: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'lte' })),
	inArray: vi.fn((col: unknown, vals: unknown) => ({ col, vals, op: 'inArray' }))
}));

vi.mock('./system-audiences', () => ({
	isSystemAudienceKey: vi.fn((key: unknown) => key === 'all-members'),
	resolveSystemAudienceRecipients: vi.fn(async () => [])
}));

vi.mock('./campaign-render', () => ({
	renderCampaignPreview: vi.fn(() => '<html>preview</html>'),
	renderCampaignForSend: vi.fn(() => '<html>send</html>')
}));

vi.mock('./unsubscribe', () => ({
	signUnsubscribeToken: vi.fn(() => 'unsub-token')
}));

vi.mock('$lib/server/notification/email', () => ({
	sendBroadcastBatch: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$env/dynamic/private', () => ({
	env: { PUBLIC_SITE_URL: 'https://test.com' }
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { db } from '$lib/server/db';
import { isNull } from 'drizzle-orm';
import { sendBroadcastBatch } from '$lib/server/notification/email';
import { renderCampaignForSend } from './campaign-render';
import { signUnsubscribeToken } from './unsubscribe';
import { resolveSystemAudienceRecipients } from './system-audiences';
import {
	deriveCampaignStatus,
	createCampaign,
	updateCampaign,
	deleteCampaign,
	scheduleCampaign,
	sendNow,
	executeSend,
	CampaignNotFoundError,
	CampaignValidationError,
	CampaignStateError
} from './campaign-service';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockCampaign = {
	id: 'camp-1',
	subject: 'Hello World',
	markdownBody: '# Hello',
	htmlBody: '<h1>Hello</h1>',
	sentById: 'user-1',
	scheduledFor: null as Date | null,
	sentAt: null as Date | null,
	recipientCount: null as number | null,
	createdAt: new Date(),
	updatedAt: new Date()
};

const mockRecipient = {
	subscriberId: 'sub-1',
	email: 'member@example.com',
	name: 'Test Member',
	audienceId: 'aud-1'
};

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------

let selectResults: unknown[][] = [];
let selectCallIndex = 0;

/**
 * Build a chainable proxy whose `.then` resolves to the next item in
 * selectResults. Every method call returns the same proxy so Drizzle-style
 * chains work: db.select().from(t).where(c).limit(1) → result.
 */
function makeChainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					const result = selectResults[selectCallIndex] ?? [];
					selectCallIndex++;
					return resolve(result);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

/**
 * Build an insert chain that tracks inserted values and resolves
 * `.returning()` from the next selectResults slot.
 */
function makeInsertChain(insertedRows: unknown[][]) {
	return vi.fn((_table: unknown) => ({
		values: vi.fn((vals: unknown) => {
			insertedRows.push(Array.isArray(vals) ? vals : [vals]);
			return {
				returning: vi.fn(() => {
					const result = selectResults[selectCallIndex] ?? [{ ...mockCampaign }];
					selectCallIndex++;
					return Promise.resolve(result);
				})
			};
		})
	}));
}

/**
 * Build an update chain that tracks set-values and resolves
 * `.returning()` from the next selectResults slot.
 */
function makeUpdateChain(updatedSets: unknown[]) {
	return vi.fn(() => ({
		set: vi.fn((vals: unknown) => {
			updatedSets.push(vals);
			return {
				where: vi.fn(() => ({
					returning: vi.fn(() => {
						const result = selectResults[selectCallIndex] ?? [{ ...mockCampaign }];
						selectCallIndex++;
						return Promise.resolve(result);
					})
				}))
			};
		})
	}));
}

/**
 * Build a delete chain that resolves immediately.
 */
function makeDeleteChain(deletedWheres: unknown[]) {
	return vi.fn(() => ({
		where: vi.fn((condition: unknown) => {
			deletedWheres.push(condition);
			return Promise.resolve({ rowCount: 1 });
		})
	}));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('campaign-service', () => {
	let insertedRows: unknown[][];
	let updatedSets: unknown[];
	let deletedWheres: unknown[];

	beforeEach(() => {
		vi.clearAllMocks();
		selectResults = [];
		selectCallIndex = 0;
		insertedRows = [];
		updatedSets = [];
		deletedWheres = [];

		vi.mocked(db.select).mockImplementation(() => makeChainable());
		vi.mocked(db.selectDistinct).mockImplementation(() => makeChainable());
		vi.mocked(db.insert).mockImplementation(makeInsertChain(insertedRows) as any);
		vi.mocked(db.update).mockImplementation(makeUpdateChain(updatedSets) as any);
		vi.mocked(db.delete).mockImplementation(makeDeleteChain(deletedWheres) as any);
	});

	// -------------------------------------------------------------------------
	// deriveCampaignStatus — pure function, no mocks needed
	// -------------------------------------------------------------------------

	describe('deriveCampaignStatus', () => {
		it('returns "sent" when sentAt is set, regardless of scheduledFor', () => {
			expect(deriveCampaignStatus(null, new Date())).toBe('sent');
			expect(deriveCampaignStatus(new Date(), new Date())).toBe('sent');
		});

		it('returns "draft" when sentAt is null and scheduledFor is null', () => {
			expect(deriveCampaignStatus(null, null)).toBe('draft');
		});

		it('returns "scheduled" when scheduledFor is in the future', () => {
			const future = new Date(Date.now() + 60_000);
			expect(deriveCampaignStatus(future, null)).toBe('scheduled');
		});

		it('returns "sending" when scheduledFor is in the past and sentAt is null', () => {
			const past = new Date(Date.now() - 60_000);
			expect(deriveCampaignStatus(past, null)).toBe('sending');
		});
	});

	// -------------------------------------------------------------------------
	// createCampaign
	// -------------------------------------------------------------------------

	describe('createCampaign', () => {
		it('throws when subject exceeds 500 characters', async () => {
			await expect(
				createCampaign({
					subject: 'x'.repeat(501),
					markdownBody: '# Hi',
					audienceIds: ['aud-1'],
					sentById: 'user-1'
				})
			).rejects.toThrow(CampaignValidationError);
		});

		it('throws when audienceIds is empty', async () => {
			await expect(
				createCampaign({
					subject: 'Hello',
					markdownBody: '# Hi',
					audienceIds: [],
					sentById: 'user-1'
				})
			).rejects.toThrow(CampaignValidationError);
		});

		it('throws when more than 20 audiences are provided', async () => {
			const ids = Array.from({ length: 21 }, (_, i) => `aud-${i}`);
			await expect(
				createCampaign({
					subject: 'Hello',
					markdownBody: '# Hi',
					audienceIds: ids,
					sentById: 'user-1'
				})
			).rejects.toThrow(CampaignValidationError);
		});

		it('inserts campaign row then audience links, returns created row', async () => {
			const created = { ...mockCampaign, id: 'camp-new' };
			selectResults = [[created]]; // consumed by insert().values().returning()

			const result = await createCampaign({
				subject: 'Hello World',
				markdownBody: '# Hello',
				audienceIds: ['aud-1', 'aud-2'],
				sentById: 'user-1'
			});

			expect(result.id).toBe('camp-new');
			// Two insert calls: campaign + campaignAudience
			expect(db.insert).toHaveBeenCalledTimes(2);
			// The second insert carries two audience link rows
			const audienceRows = insertedRows[1] as { campaignId: string; audienceId: string }[];
			expect(audienceRows).toHaveLength(2);
			expect(audienceRows[0].audienceId).toBe('aud-1');
			expect(audienceRows[1].audienceId).toBe('aud-2');
		});
	});

	// -------------------------------------------------------------------------
	// updateCampaign
	// -------------------------------------------------------------------------

	describe('updateCampaign', () => {
		it('throws when campaign is not found', async () => {
			selectResults = [[]];

			await expect(updateCampaign('camp-999', { subject: 'New Subject' })).rejects.toThrow(
				CampaignNotFoundError
			);
		});

		it('throws when campaign is sent (non-draft)', async () => {
			selectResults = [[{ ...mockCampaign, sentAt: new Date() }]];

			await expect(updateCampaign('camp-1', { subject: 'New Subject' })).rejects.toThrow(
				CampaignStateError
			);
		});

		it('throws when campaign is scheduled (non-draft)', async () => {
			selectResults = [[{ ...mockCampaign, scheduledFor: new Date(Date.now() + 60_000) }]];

			await expect(updateCampaign('camp-1', { subject: 'New Subject' })).rejects.toThrow(
				CampaignStateError
			);
		});

		it('validates subject length on update', async () => {
			selectResults = [[{ ...mockCampaign }]];

			await expect(updateCampaign('camp-1', { subject: 'x'.repeat(501) })).rejects.toThrow(
				CampaignValidationError
			);
		});

		it('validates audienceIds not empty on update', async () => {
			selectResults = [[{ ...mockCampaign }]];

			await expect(updateCampaign('camp-1', { audienceIds: [] })).rejects.toThrow(
				CampaignValidationError
			);
		});

		it('replaces audience links when audienceIds are provided', async () => {
			selectResults = [
				[{ ...mockCampaign }], // getCampaignRaw
				[{ ...mockCampaign }] // update().returning()
			];

			await updateCampaign('camp-1', { audienceIds: ['aud-3'] });

			// Deletes old links then inserts new ones
			expect(db.delete).toHaveBeenCalled();
			expect(db.insert).toHaveBeenCalled();
			const newLinks = insertedRows[0] as { campaignId: string; audienceId: string }[];
			expect(newLinks[0].audienceId).toBe('aud-3');
		});
	});

	// -------------------------------------------------------------------------
	// deleteCampaign
	// -------------------------------------------------------------------------

	describe('deleteCampaign', () => {
		it('throws when campaign is not found', async () => {
			selectResults = [[]];

			await expect(deleteCampaign('camp-999')).rejects.toThrow(CampaignNotFoundError);
		});

		it('throws when campaign is not in draft status', async () => {
			selectResults = [[{ ...mockCampaign, sentAt: new Date() }]];

			await expect(deleteCampaign('camp-1')).rejects.toThrow(CampaignStateError);
		});

		it('deletes a draft campaign', async () => {
			selectResults = [[{ ...mockCampaign }]];

			await expect(deleteCampaign('camp-1')).resolves.not.toThrow();
			expect(db.delete).toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// scheduleCampaign
	// -------------------------------------------------------------------------

	describe('scheduleCampaign', () => {
		it('throws when campaign is not in draft status', async () => {
			selectResults = [[{ ...mockCampaign, sentAt: new Date() }]];
			const future = new Date(Date.now() + 60_000);

			await expect(scheduleCampaign('camp-1', future)).rejects.toThrow(CampaignStateError);
		});

		it('throws when scheduledFor is in the past', async () => {
			selectResults = [[{ ...mockCampaign }]];
			const past = new Date(Date.now() - 60_000);

			await expect(scheduleCampaign('camp-1', past)).rejects.toThrow(CampaignValidationError);
		});

		it('sets scheduledFor on a draft campaign', async () => {
			selectResults = [[{ ...mockCampaign }]];
			const future = new Date(Date.now() + 60_000);

			await expect(scheduleCampaign('camp-1', future)).resolves.not.toThrow();
			expect(db.update).toHaveBeenCalled();
			const setCall = updatedSets[0] as { scheduledFor: Date };
			expect(setCall.scheduledFor).toBe(future);
		});
	});

	// -------------------------------------------------------------------------
	// sendNow
	// -------------------------------------------------------------------------

	describe('sendNow', () => {
		it('throws when campaign is not in draft status', async () => {
			selectResults = [[{ ...mockCampaign, sentAt: new Date() }]];

			await expect(sendNow('camp-1')).rejects.toThrow(CampaignStateError);
		});

		it('updates scheduledFor and calls executeSend for a draft campaign', async () => {
			// sendNow → getCampaignRaw
			// executeSend → getCampaignRaw → getRecipientsForCampaign (audienceIds) → 0 recipients
			selectResults = [
				[{ ...mockCampaign }], // sendNow getCampaignRaw
				[{ ...mockCampaign }], // executeSend getCampaignRaw
				[] // getRecipientsForCampaign audienceIds (empty → early return)
			];

			await sendNow('camp-1');

			// First update is from sendNow (sets scheduledFor=now)
			// Second update is from executeSend (marks sentAt, recipientCount=0)
			expect(db.update).toHaveBeenCalledTimes(2);
		});
	});

	// -------------------------------------------------------------------------
	// executeSend
	// -------------------------------------------------------------------------

	describe('executeSend', () => {
		it('throws when campaign is not found', async () => {
			selectResults = [[]];

			await expect(executeSend('camp-999')).rejects.toThrow(CampaignNotFoundError);
		});

		it('throws when campaign is already sent', async () => {
			selectResults = [[{ ...mockCampaign, sentAt: new Date() }]];

			await expect(executeSend('camp-1')).rejects.toThrow(CampaignStateError);
		});

		it('returns 0 and marks campaign sent with recipientCount 0 when no recipients', async () => {
			selectResults = [
				[{ ...mockCampaign }], // getCampaignRaw
				[] // getRecipientsForCampaign → audienceIds select (empty)
			];

			const count = await executeSend('camp-1');

			expect(count).toBe(0);
			expect(sendBroadcastBatch).not.toHaveBeenCalled();
			expect(db.update).toHaveBeenCalled();
			const setCall = updatedSets[0] as { recipientCount: number };
			expect(setCall.recipientCount).toBe(0);
		});

		it('calls sendBroadcastBatch with one message per recipient', async () => {
			selectResults = [
				[{ ...mockCampaign }], // getCampaignRaw
				[{ audienceId: 'aud-1' }], // getRecipientsForCampaign → audienceIds
				[mockRecipient] // getRecipientsForCampaign → selectDistinct subscribers
			];

			const count = await executeSend('camp-1');

			expect(count).toBe(1);
			expect(sendBroadcastBatch).toHaveBeenCalledOnce();
			const [messages] = vi.mocked(sendBroadcastBatch).mock.calls[0];
			expect(messages).toHaveLength(1);
			expect(messages[0].to).toBe(mockRecipient.email);
			expect(messages[0].subject).toBe(mockCampaign.subject);
			expect(messages[0].tag).toBe('campaign');
			// one-click unsubscribe headers (RFC 8058)
			expect(messages[0].headers).toEqual([
				{ Name: 'List-Unsubscribe', Value: '<https://test.com/unsubscribe/unsub-token>' },
				{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
			]);
		});

		it('filters out globally-suppressed subscribers in the recipient query', async () => {
			selectResults = [[{ ...mockCampaign }], [{ audienceId: 'aud-1' }], [mockRecipient]];

			await executeSend('camp-1');

			// The recipient WHERE clause must include isNull(subscriber.suppressedAt).
			const isNullCols = vi.mocked(isNull).mock.calls.map((c) => c[0]);
			expect(isNullCols).toContain('subscriber.suppressedAt');
		});

		it('marks campaign as sent with correct recipient count after sending', async () => {
			selectResults = [[{ ...mockCampaign }], [{ audienceId: 'aud-1' }], [mockRecipient]];

			await executeSend('camp-1');

			const setCall = updatedSets[0] as { recipientCount: number; sentAt: Date };
			expect(setCall.recipientCount).toBe(1);
			expect(setCall.sentAt).toBeInstanceOf(Date);
		});

		// Regression: a subscriber who belongs to two of the campaign's audiences
		// used to receive one copy per audience, because the recipient query
		// selectDistinct'd a tuple that included audienceId. Built-in audiences
		// overlap every static list, so this went from rare to routine.
		it('sends exactly one message to a subscriber who is in two targeted audiences', async () => {
			selectResults = [
				[{ ...mockCampaign }], // getCampaignRaw
				[
					{ audienceId: 'aud-1', id: 'aud-1', systemKey: null },
					{ audienceId: 'aud-2', id: 'aud-2', systemKey: null }
				], // campaign's audiences
				[
					{ ...mockRecipient, audienceId: 'aud-1' },
					{ ...mockRecipient, audienceId: 'aud-2' }
				] // same subscriber, once per audience
			];

			const count = await executeSend('camp-1');

			expect(count).toBe(1);
			const [messages] = vi.mocked(sendBroadcastBatch).mock.calls[0];
			expect(messages).toHaveLength(1);
			expect(messages[0].to).toBe(mockRecipient.email);
		});

		it('sends one message when a member is in both a built-in and a static audience', async () => {
			vi.mocked(resolveSystemAudienceRecipients).mockResolvedValueOnce([
				{ ...mockRecipient, audienceId: 'aud-system' }
			]);
			selectResults = [
				[{ ...mockCampaign }],
				[
					{ audienceId: 'aud-1', id: 'aud-1', systemKey: null },
					{ audienceId: 'aud-system', id: 'aud-system', systemKey: 'all-members' }
				],
				[{ ...mockRecipient, audienceId: 'aud-1' }] // static-list query
			];

			const count = await executeSend('camp-1');

			expect(count).toBe(1);
			expect(resolveSystemAudienceRecipients).toHaveBeenCalledWith('aud-system', 'all-members');
		});

		it('does not run the static-list query when every targeted audience is built-in', async () => {
			vi.mocked(resolveSystemAudienceRecipients).mockResolvedValueOnce([
				{ ...mockRecipient, audienceId: 'aud-system' }
			]);
			selectResults = [
				[{ ...mockCampaign }],
				[{ audienceId: 'aud-system', id: 'aud-system', systemKey: 'all-members' }]
			];

			const count = await executeSend('camp-1');

			expect(count).toBe(1);
			expect(db.selectDistinct).not.toHaveBeenCalled();
		});

		it('scopes a deduplicated recipient to a deterministic audience', async () => {
			// The retained audienceId scopes the unsubscribe token, so it must not
			// depend on row order coming back from the database.
			const rows = [
				{ ...mockRecipient, audienceId: 'aud-2' },
				{ ...mockRecipient, audienceId: 'aud-1' }
			];
			selectResults = [
				[{ ...mockCampaign }],
				[
					{ audienceId: 'aud-1', id: 'aud-1', systemKey: null },
					{ audienceId: 'aud-2', id: 'aud-2', systemKey: null }
				],
				rows
			];

			await executeSend('camp-1');

			expect(signUnsubscribeToken).toHaveBeenCalledWith(mockRecipient.subscriberId, 'aud-1');
		});

		it('builds unsubscribe URL from env.PUBLIC_SITE_URL and renders per-recipient HTML', async () => {
			selectResults = [[{ ...mockCampaign }], [{ audienceId: 'aud-1' }], [mockRecipient]];

			await executeSend('camp-1');

			expect(signUnsubscribeToken).toHaveBeenCalledWith(
				mockRecipient.subscriberId,
				mockRecipient.audienceId
			);
			expect(renderCampaignForSend).toHaveBeenCalledWith(
				mockCampaign.markdownBody,
				mockRecipient.name,
				'https://test.com/unsubscribe/unsub-token'
			);
		});
	});
});
