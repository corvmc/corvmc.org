import { describe, it, expect, vi, beforeEach } from 'vitest';

// Audiences against a real SQLite, with the real built-in resolver: counts are
// joins and the built-in guardrails turn on a row's system_key.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const {
	createAudience,
	updateAudience,
	deleteAudience,
	listAudiences,
	getAudience,
	listSubscribers,
	addSubscriber,
	removeSubscriber,
	bulkAddMembers,
	unsubscribe,
	BuiltInAudienceError,
	AudienceValidationError
} = await import('./audience-service');

const T0 = 1_750_000_000;

function aud(id: string, opts: { slug?: string; systemKey?: string; allowOptIn?: boolean } = {}) {
	sqlite
		.prepare(
			`insert into audience (id, name, slug, description, allow_opt_in, system_key)
			 values (?, ?, ?, 'desc', ?, ?)`
		)
		.run(id, id, opts.slug ?? id, opts.allowOptIn ? 1 : 0, opts.systemKey ?? null);
}

function sub(id: string, email: string, opts: { userId?: string; suppressedAt?: number } = {}) {
	sqlite
		.prepare(`insert into subscriber (id, email, user_id, suppressed_at) values (?, ?, ?, ?)`)
		.run(id, email, opts.userId ?? null, opts.suppressedAt ?? null);
}

function member(id: string, audienceId: string, subscriberId: string, unsubscribedAt?: number) {
	sqlite
		.prepare(
			`insert into audience_member (id, audience_id, subscriber_id, unsubscribed_at, created_at)
			 values (?, ?, ?, ?, ?)`
		)
		.run(id, audienceId, subscriberId, unsubscribedAt ?? null, T0);
}

function account(id: string, email: string, deletedAt: number | null = null) {
	sqlite
		.prepare(`insert into user (id, name, email, deleted_at) values (?, ?, ?, ?)`)
		.run(id, id, email, deletedAt);
}

const audienceRow = (id: string) =>
	sqlite.prepare('select * from audience where id = ?').get(id) as
		{ name: string; slug: string; description: string; allow_opt_in: number } | undefined;
const members = (audienceId: string) =>
	sqlite
		.prepare(
			'select subscriber_id, unsubscribed_at from audience_member where audience_id = ? order by subscriber_id'
		)
		.all(audienceId) as { subscriber_id: string; unsubscribed_at: number | null }[];

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of ['audience_member', 'subscriber', 'audience', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	aud('aud-1');
	aud('aud-sys', { slug: 'all-members', systemKey: 'all-members' });
});

describe('createAudience', () => {
	it('creates an audience with valid data', async () => {
		const result = await createAudience({ name: 'Newsletter', slug: 'newsletter' });

		expect(audienceRow(result.id)).toMatchObject({
			name: 'Newsletter',
			slug: 'newsletter',
			allow_opt_in: 0
		});
	});

	it('throws when name is too long', async () => {
		await expect(createAudience({ name: 'x'.repeat(256), slug: 'test' })).rejects.toThrow(
			AudienceValidationError
		);
	});

	it('throws when slug is too long', async () => {
		await expect(createAudience({ name: 'OK', slug: 'x'.repeat(101) })).rejects.toThrow(
			AudienceValidationError
		);
	});

	it('throws when slug has invalid characters', async () => {
		await expect(createAudience({ name: 'OK', slug: 'Bad Slug!' })).rejects.toThrow(
			AudienceValidationError
		);
	});
});

describe('updateAudience', () => {
	it('updates audience fields', async () => {
		aud('aud-2');

		expect(await updateAudience('aud-1', { name: 'Updated' })).toBeTruthy();

		expect(audienceRow('aud-1')?.name).toBe('Updated');
		expect(audienceRow('aud-2')?.name).toBe('aud-2');
	});

	it('validates slug format on update', async () => {
		await expect(updateAudience('aud-1', { slug: 'INVALID!' })).rejects.toThrow(
			AudienceValidationError
		);
	});

	// A form that only renamed the audience used to switch public opt-in off on
	// its way past: an absent key must not reach the update at all (#1074).
	it('leaves a field alone when the caller does not name it', async () => {
		aud('aud-open', { allowOptIn: true });

		await updateAudience('aud-open', { name: 'Renamed' });

		expect(audienceRow('aud-open')?.allow_opt_in).toBe(1);
	});
});

describe('deleteAudience', () => {
	it('deletes the audience', async () => {
		await deleteAudience('aud-1');

		expect(audienceRow('aud-1')).toBeUndefined();
		expect(audienceRow('aud-sys')).toBeDefined();
	});
});

describe('addSubscriber', () => {
	it('inserts new membership when subscriber not in audience', async () => {
		sub('sub-1', 'a@example.com');
		aud('aud-2');
		member('am-x', 'aud-2', 'sub-1');

		await addSubscriber('aud-1', 'sub-1');

		expect(members('aud-1')).toEqual([{ subscriber_id: 'sub-1', unsubscribed_at: null }]);
	});

	it('re-subscribes when previously unsubscribed', async () => {
		sub('sub-1', 'a@example.com');
		member('am-1', 'aud-1', 'sub-1', T0);

		await addSubscriber('aud-1', 'sub-1');

		expect(members('aud-1')).toEqual([{ subscriber_id: 'sub-1', unsubscribed_at: null }]);
	});

	it('does nothing when already active', async () => {
		sub('sub-1', 'a@example.com');
		member('am-1', 'aud-1', 'sub-1');

		await addSubscriber('aud-1', 'sub-1');

		expect(members('aud-1')).toHaveLength(1);
	});
});

describe('removeSubscriber', () => {
	it('deletes only that audience member row', async () => {
		sub('sub-1', 'a@example.com');
		sub('sub-2', 'b@example.com');
		aud('aud-2');
		member('am-1', 'aud-1', 'sub-1');
		member('am-2', 'aud-1', 'sub-2');
		member('am-3', 'aud-2', 'sub-1');

		await removeSubscriber('aud-1', 'sub-1');

		expect(members('aud-1').map((m) => m.subscriber_id)).toEqual(['sub-2']);
		expect(members('aud-2')).toHaveLength(1);
	});
});

// A built-in audience's membership is a SQL predicate, so there is no list to
// edit. Each mutation must refuse rather than silently write rows that the
// resolver would then ignore.
describe('built-in audience guardrails', () => {
	it('refuses to delete a built-in audience', async () => {
		await expect(deleteAudience('aud-sys')).rejects.toThrow(BuiltInAudienceError);
		expect(audienceRow('aud-sys')).toBeDefined();
	});

	it('refuses to add a subscriber to a built-in audience', async () => {
		sub('sub-1', 'a@example.com');
		await expect(addSubscriber('aud-sys', 'sub-1')).rejects.toThrow(BuiltInAudienceError);
		expect(members('aud-sys')).toHaveLength(0);
	});

	it('refuses to remove a subscriber from a built-in audience', async () => {
		sub('sub-1', 'a@example.com');
		member('am-1', 'aud-sys', 'sub-1', T0);
		await expect(removeSubscriber('aud-sys', 'sub-1')).rejects.toThrow(BuiltInAudienceError);
		expect(members('aud-sys')).toHaveLength(1);
	});

	it('refuses to bulk-add members to a built-in audience', async () => {
		account('user-1', 'a@example.com');
		await expect(bulkAddMembers('aud-sys')).rejects.toThrow(BuiltInAudienceError);
		expect(members('aud-sys')).toHaveLength(0);
	});

	it('refuses to change a built-in audience slug', async () => {
		await expect(updateAudience('aud-sys', { slug: 'renamed' })).rejects.toThrow(
			BuiltInAudienceError
		);
		expect(audienceRow('aud-sys')?.slug).toBe('all-members');
	});

	it('refuses to open a built-in audience to public opt-in', async () => {
		await expect(updateAudience('aud-sys', { allowOptIn: true })).rejects.toThrow(
			BuiltInAudienceError
		);
		expect(audienceRow('aud-sys')?.allow_opt_in).toBe(0);
	});

	it('still allows editing a built-in audience name and description', async () => {
		await updateAudience('aud-sys', { name: 'Everyone', description: 'All of them' });

		expect(audienceRow('aud-sys')).toMatchObject({ name: 'Everyone', description: 'All of them' });
	});

	it('reports the live count for a built-in audience instead of the row count', async () => {
		account('user-1', 'a@example.com');
		account('user-2', 'b@example.com');
		account('user-gone', 'c@example.com', T0);
		// audience_member rows for a built-in are opt-out tombstones, so a joined
		// row count is meaningless and must not be surfaced.
		for (const n of [1, 2, 3]) {
			sub(`sub-t${n}`, `t${n}@example.com`);
			member(`am-t${n}`, 'aud-sys', `sub-t${n}`, T0);
		}

		expect((await getAudience('aud-sys'))!.subscriberCount).toBe(2);
	});

	it('lists a live preview instead of tombstone rows for a built-in audience', async () => {
		account('user-1', 'member@example.com');
		sub('sub-t', 'tombstone@example.com');
		member('am-t', 'aud-sys', 'sub-t', T0);

		const result = await listSubscribers('aud-sys');

		expect(result.map((r) => r.email)).toEqual(['member@example.com']);
	});
});

describe('unsubscribe', () => {
	// Upsert, not update: a built-in audience has no membership row to flip, so
	// the inserted row IS the opt-out record.
	it('inserts a tombstone row carrying the opt-out timestamp', async () => {
		sub('sub-1', 'a@example.com');

		await unsubscribe('sub-1', 'aud-sys');

		expect(members('aud-sys')).toEqual([
			{ subscriber_id: 'sub-1', unsubscribed_at: expect.any(Number) }
		]);
	});

	it('flips an existing membership row rather than duplicating it', async () => {
		sub('sub-1', 'a@example.com');
		member('am-1', 'aud-1', 'sub-1');

		await unsubscribe('sub-1', 'aud-1');

		expect(members('aud-1')).toEqual([
			{ subscriber_id: 'sub-1', unsubscribed_at: expect.any(Number) }
		]);
	});

	it('keeps the original opt-out timestamp on a repeat', async () => {
		sub('sub-1', 'a@example.com');
		member('am-1', 'aud-1', 'sub-1', T0);

		await unsubscribe('sub-1', 'aud-1');

		expect(members('aud-1')).toEqual([{ subscriber_id: 'sub-1', unsubscribed_at: T0 }]);
	});
});

describe('bulkAddMembers', () => {
	it('adds every active account, re-subscribing the opted-out and skipping the deleted', async () => {
		account('user-1', 'a@example.com');
		account('user-2', 'b@example.com');
		account('user-gone', 'gone@example.com', T0);
		sub('sub-b', 'b@example.com', { userId: 'user-2' });
		member('am-b', 'aud-1', 'sub-b', T0);

		expect(await bulkAddMembers('aud-1')).toBe(2);

		const rows = sqlite
			.prepare(
				`select s.email, s.user_id, am.unsubscribed_at from audience_member am
				 join subscriber s on s.id = am.subscriber_id where am.audience_id = 'aud-1' order by s.email`
			)
			.all();
		expect(rows).toEqual([
			{ email: 'a@example.com', user_id: 'user-1', unsubscribed_at: null },
			{ email: 'b@example.com', user_id: 'user-2', unsubscribed_at: null }
		]);
	});
});

describe('listAudiences', () => {
	it('counts only active, unsuppressed members of a static list', async () => {
		sub('sub-1', 'a@example.com');
		sub('sub-2', 'b@example.com');
		sub('sub-3', 'c@example.com', { suppressedAt: T0 });
		member('am-1', 'aud-1', 'sub-1');
		member('am-2', 'aud-1', 'sub-2', T0);
		member('am-3', 'aud-1', 'sub-3');

		const result = await listAudiences();

		expect(result.find((a) => a.id === 'aud-1')?.subscriberCount).toBe(1);
	});
});

describe('getAudience', () => {
	it('returns null when not found', async () => {
		expect(await getAudience('nonexistent')).toBeNull();
	});

	it('returns the audience with its subscriber count', async () => {
		sub('sub-1', 'a@example.com');
		member('am-1', 'aud-1', 'sub-1');

		expect(await getAudience('aud-1')).toMatchObject({ name: 'aud-1', subscriberCount: 1 });
	});
});
