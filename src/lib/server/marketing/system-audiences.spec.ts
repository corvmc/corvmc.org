import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Only the database is mocked. drizzle-orm and the schema are real, so the
// predicates below can be rendered to actual SQL and asserted on — which is the
// whole substance of this module.
// ---------------------------------------------------------------------------

let selectResults: unknown[][] = [];
let selectCallIndex = 0;
const insertedRows: unknown[][] = [];
const updatedSets: unknown[] = [];

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

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => makeChainable(),
		insert: () => ({
			values: (rows: unknown) => {
				insertedRows.push(Array.isArray(rows) ? rows : [rows]);
				return {
					onConflictDoNothing: () => Promise.resolve(undefined),
					then: (resolve: (v: unknown) => void) => resolve(undefined)
				};
			}
		}),
		update: () => {
			const chain: any = new Proxy(() => chain, {
				get(_, prop) {
					if (prop === 'set')
						return (data: unknown) => {
							updatedSets.push(data);
							return chain;
						};
					if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(undefined);
					return () => chain;
				}
			});
			return chain;
		}
	}
}));

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
	SYSTEM_AUDIENCES,
	isSystemAudienceKey,
	ensureSystemAudiences,
	ensureSubscribersForUsers,
	resolveSystemAudienceRecipients,
	countSystemAudience,
	type SystemAudienceKey
} from './system-audiences';

const dialect = new SQLiteSyncDialect();

/** Render a predicate to the SQL text that will actually reach D1. */
function render(sql: SQL): string {
	return dialect.sqlToQuery(sql).sql;
}

function predicateSql(key: SystemAudienceKey): string {
	return render(SYSTEM_AUDIENCES[key].predicate());
}

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	selectCallIndex = 0;
	insertedRows.length = 0;
	updatedSets.length = 0;
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('SYSTEM_AUDIENCES registry', () => {
	const keys = Object.keys(SYSTEM_AUDIENCES) as SystemAudienceKey[];

	it('ships the four built-in audiences', () => {
		expect(keys).toEqual([
			'all-members',
			'sustaining-members',
			'non-sustaining-members',
			'band-leaders'
		]);
	});

	it('gives every entry a name and description for the staff UI', () => {
		for (const key of keys) {
			expect(SYSTEM_AUDIENCES[key].name.length, key).toBeGreaterThan(0);
			expect(SYSTEM_AUDIENCES[key].description.length, key).toBeGreaterThan(0);
		}
	});

	it('recognises its own keys and nothing else', () => {
		for (const key of keys) expect(isSystemAudienceKey(key)).toBe(true);
		// A staff-curated list has a null systemKey and must not be treated as one.
		expect(isSystemAudienceKey(null)).toBe(false);
		expect(isSystemAudienceKey(undefined)).toBe(false);
		expect(isSystemAudienceKey('newsletter')).toBe(false);
	});

	it('gives every audience a distinct predicate', () => {
		const rendered = keys.map(predicateSql);
		expect(new Set(rendered).size).toBe(keys.length);
	});
});

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

describe('predicates', () => {
	it('every predicate excludes soft-deleted accounts', () => {
		for (const key of Object.keys(SYSTEM_AUDIENCES) as SystemAudienceKey[]) {
			expect(predicateSql(key), key).toContain('"user"."deleted_at" is null');
		}
	});

	it('sustaining status reads the subscription snapshot, not the legacy role', () => {
		const sql = predicateSql('sustaining-members');
		expect(sql).toContain('"user"."subscription" is not null');
		expect(sql).not.toContain('role');
	});

	it('non-sustaining is the negation of sustaining', () => {
		expect(predicateSql('non-sustaining-members')).toContain(
			'not "user"."subscription" is not null'
		);
	});

	it('band-leaders matches only owners and admins of live bands', () => {
		const sql = predicateSql('band-leaders');
		expect(sql).toContain('"band_member"."role" in (\'owner\', \'admin\')');
		expect(sql).toContain('"band_member"."status" = \'active\'');
		expect(sql).toContain('"group"."deleted_at" is null');
	});

	// Regression guard: an unqualified outer reference would bind to the
	// subquery's own tables — both `band` and `band_member` have an `id` — and
	// silently match every user instead of failing. The predicate interpolates
	// `user.id` rather than spelling it, so this also pins the fact that drizzle
	// renders it with its table prefix intact in this position.
	it('band-leaders qualifies its correlated outer reference', () => {
		expect(predicateSql('band-leaders')).toContain('"band_member"."user_id" = "user"."id"');
	});
});

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

describe('ensureSystemAudiences', () => {
	it('creates a row for every built-in when none exist', async () => {
		selectResults = [[]];

		await ensureSystemAudiences();

		expect(insertedRows).toHaveLength(1);
		const rows = insertedRows[0] as { slug: string; systemKey: string; allowOptIn: boolean }[];
		expect(rows.map((r) => r.systemKey)).toEqual(Object.keys(SYSTEM_AUDIENCES));
		// slug and systemKey are the same identifier — the UI routes on slug.
		expect(rows.every((r) => r.slug === r.systemKey)).toBe(true);
	});

	it('never opens a built-in to public opt-in', async () => {
		selectResults = [[]];

		await ensureSystemAudiences();

		const rows = insertedRows[0] as { allowOptIn: boolean }[];
		expect(rows.every((r) => r.allowOptIn === false)).toBe(true);
	});

	it('is idempotent — inserts nothing when all built-ins already exist', async () => {
		selectResults = [Object.keys(SYSTEM_AUDIENCES).map((systemKey) => ({ systemKey }))];

		await ensureSystemAudiences();

		expect(insertedRows).toHaveLength(0);
	});

	it('backfills only the built-ins that are missing', async () => {
		selectResults = [[{ systemKey: 'all-members' }, { systemKey: 'sustaining-members' }]];

		await ensureSystemAudiences();

		const rows = insertedRows[0] as { systemKey: string }[];
		expect(rows.map((r) => r.systemKey)).toEqual(['non-sustaining-members', 'band-leaders']);
	});
});

// ---------------------------------------------------------------------------
// Subscriber backfill
// ---------------------------------------------------------------------------

describe('ensureSubscribersForUsers', () => {
	const predicate = SYSTEM_AUDIENCES['all-members'].predicate();

	it('does nothing when every matching member already has a linked subscriber', async () => {
		selectResults = [[]];

		await ensureSubscribersForUsers(predicate);

		expect(insertedRows).toHaveLength(0);
		expect(updatedSets).toHaveLength(0);
	});

	it('links an existing subscriber row rather than creating a duplicate', async () => {
		// A public signup under this address who has since become a member.
		selectResults = [
			[{ userId: 'user-1', email: 'a@example.com', name: 'A', subscriberId: 'sub-1' }]
		];

		await ensureSubscribersForUsers(predicate);

		expect(updatedSets).toEqual([{ userId: 'user-1' }]);
		expect(insertedRows).toHaveLength(0);
	});

	it('creates linked subscriber rows for members who have none', async () => {
		selectResults = [[{ userId: 'user-1', email: 'a@example.com', name: 'A', subscriberId: null }]];

		await ensureSubscribersForUsers(predicate);

		expect(updatedSets).toHaveLength(0);
		expect(insertedRows[0]).toEqual([{ email: 'a@example.com', name: 'A', userId: 'user-1' }]);
	});

	// D1 rejects a statement binding more than 100 parameters, and each row here
	// binds four. A single insert for a full membership would fail at send time.
	it('chunks the insert so a large membership stays under the D1 parameter cap', async () => {
		selectResults = [
			Array.from({ length: 45 }, (_, i) => ({
				userId: `user-${i}`,
				email: `u${i}@example.com`,
				name: `U${i}`,
				subscriberId: null
			}))
		];

		await ensureSubscribersForUsers(predicate);

		expect(insertedRows).toHaveLength(3);
		for (const chunk of insertedRows) {
			expect(chunk.length * 4).toBeLessThanOrEqual(100);
		}
		expect(insertedRows.flat()).toHaveLength(45);
	});
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe('resolveSystemAudienceRecipients', () => {
	it('tags every recipient with the audience that scopes their unsubscribe token', async () => {
		selectResults = [
			[], // backfill: nothing to do
			[{ subscriberId: 'sub-1', email: 'a@example.com', name: 'A' }]
		];

		const rows = await resolveSystemAudienceRecipients('aud-sys', 'all-members');

		expect(rows).toEqual([
			{ subscriberId: 'sub-1', email: 'a@example.com', name: 'A', audienceId: 'aud-sys' }
		]);
	});

	it('backfills subscriber records before resolving', async () => {
		selectResults = [
			[{ userId: 'user-1', email: 'a@example.com', name: 'A', subscriberId: null }],
			[]
		];

		await resolveSystemAudienceRecipients('aud-sys', 'all-members');

		// A member who never subscribed would otherwise be unreachable.
		expect(insertedRows.flat()).toHaveLength(1);
	});
});

describe('countSystemAudience', () => {
	it('returns the live count', async () => {
		selectResults = [[{ count: 42 }]];
		await expect(countSystemAudience('aud-sys', 'all-members')).resolves.toBe(42);
	});

	it('returns 0 rather than undefined when the query yields no row', async () => {
		selectResults = [[]];
		await expect(countSystemAudience('aud-sys', 'all-members')).resolves.toBe(0);
	});
});
