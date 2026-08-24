import { describe, it, expect, vi, beforeEach } from 'vitest';

// Three rules carry the weight in this file, and each is the kind that looks
// redundant to someone tidying up later:
//
//   1. `(userId, scope)` is the key, not `userId`. An upheld report about a gig
//      listing must not put someone on probation for suggestions.
//   2. `scopeForFlag` is NOT the identity function — an `event` report only
//      costs standing when the event is a member's community listing.
//   3. Restoring is an UPDATE. Absence of a row means good standing, so
//      restoring someone who was never restricted must not insert one.

const TABLES = {
	memberStanding: {
		__table: 'member_standing',
		userId: 'standing.userId',
		scope: 'standing.scope',
		status: 'standing.status',
		reason: 'standing.reason',
		triggeringFlagId: 'standing.triggeringFlagId',
		updatedByUserId: 'standing.updatedByUserId',
		updatedAt: 'standing.updatedAt'
	}
};

let results: unknown[] = [];
let inserted: { table: string; values: unknown; conflict: unknown }[] = [];
let updated: { table: string; set: unknown; where: unknown }[] = [];
let selectWheres: unknown[] = [];

function chain(record?: (key: string, value: unknown) => void) {
	const self: Record<string, unknown> = {};
	for (const m of ['from', 'orderBy', 'limit']) self[m] = () => self;
	self.where = (w: unknown) => {
		record?.('where', w);
		return self;
	};
	self.values = (v: unknown) => {
		record?.('values', v);
		return self;
	};
	self.set = (v: unknown) => {
		record?.('set', v);
		return self;
	};
	self.onConflictDoUpdate = (c: unknown) => {
		record?.('conflict', c);
		return self;
	};
	self.then = (resolve: (v: unknown) => unknown) => resolve(results.shift() ?? []);
	return self;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () =>
			chain((k, v) => {
				if (k === 'where') selectWheres.push(v);
			}),
		insert: (table: { __table: string }) => {
			const entry = {
				table: table.__table,
				values: undefined as unknown,
				conflict: undefined as unknown
			};
			inserted.push(entry);
			return chain((k, v) => {
				if (k === 'values') entry.values = v;
				if (k === 'conflict') entry.conflict = v;
			});
		},
		update: (table: { __table: string }) => {
			const entry = {
				table: table.__table,
				set: undefined as unknown,
				where: undefined as unknown
			};
			updated.push(entry);
			return chain((k, v) => {
				if (k === 'set') entry.set = v;
				if (k === 'where') entry.where = v;
			});
		}
	}
}));
vi.mock('$lib/server/db/schema/standing', () => TABLES);

vi.mock('drizzle-orm', () => ({
	eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
	and: (...a: unknown[]) => ({ op: 'and', a })
}));

const {
	getStanding,
	getStandings,
	setStanding,
	restrictStanding,
	restoreStanding,
	scopeForFlag,
	StandingStatusNotAllowedError
} = await import('./standing-service');

beforeEach(() => {
	results = [];
	inserted = [];
	updated = [];
	selectWheres = [];
});

describe('getStanding', () => {
	it('treats an absent row as good standing — the case every reader assumes', async () => {
		results = [[]];
		await expect(getStanding('u1', 'suggestion')).resolves.toEqual({
			status: 'none',
			reason: null,
			triggeringFlagId: null,
			updatedAt: null
		});
	});

	it('reads the stored row when there is one', async () => {
		const updatedAt = new Date('2026-01-01');
		results = [[{ status: 'restricted', reason: 'Spam', triggeringFlagId: 'f1', updatedAt }]];
		await expect(getStanding('u1', 'suggestion')).resolves.toEqual({
			status: 'restricted',
			reason: 'Spam',
			triggeringFlagId: 'f1',
			updatedAt
		});
	});

	// The point of the whole table. A single global standing was explicitly
	// rejected: being on review for gig listings says nothing about suggestions.
	it('narrows on the scope as well as the member', async () => {
		results = [[]];
		await getStanding('u1', 'messaging');
		expect(selectWheres[0]).toEqual({
			op: 'and',
			a: [
				{ op: 'eq', a: 'standing.userId', b: 'u1' },
				{ op: 'eq', a: 'standing.scope', b: 'messaging' }
			]
		});
	});
});

describe('getStandings', () => {
	it('fills in every scope from one query, defaulting the absent ones', async () => {
		results = [
			[
				{
					scope: 'suggestion',
					status: 'restricted',
					reason: 'Spam',
					triggeringFlagId: 'f1',
					updatedAt: null
				}
			]
		];

		const all = await getStandings('u1');

		expect(Object.keys(all).sort()).toEqual(['community_event', 'messaging', 'suggestion']);
		expect(all.suggestion.status).toBe('restricted');
		expect(all.community_event.status).toBe('none');
		expect(all.messaging.status).toBe('none');
	});

	it('reads the member once, not once per scope', async () => {
		results = [[]];
		await getStandings('u1');
		expect(selectWheres).toEqual([{ op: 'eq', a: 'standing.userId', b: 'u1' }]);
	});
});

describe('setStanding', () => {
	it('upserts on the composite key, so a second upheld report restates rather than fails', async () => {
		await setStanding({
			userId: 'u1',
			scope: 'suggestion',
			status: 'restricted',
			staffId: 'staff1',
			reason: 'Spam',
			flagId: 'f1'
		});

		expect(inserted[0].table).toBe('member_standing');
		expect(inserted[0].values).toMatchObject({
			userId: 'u1',
			scope: 'suggestion',
			status: 'restricted',
			reason: 'Spam',
			triggeringFlagId: 'f1',
			updatedByUserId: 'staff1'
		});
		expect(inserted[0].conflict).toMatchObject({
			target: ['standing.userId', 'standing.scope']
		});
	});

	// Only messaging has a use for `disabled`. "You may not post community
	// listings at all" is not a thing staff can do, so storing it would leave a
	// value in the column that no reader knows how to interpret.
	it('refuses a status the scope has no meaning for', async () => {
		await expect(
			setStanding({ userId: 'u1', scope: 'suggestion', status: 'disabled', staffId: 'staff1' })
		).rejects.toBeInstanceOf(StandingStatusNotAllowedError);
		expect(inserted).toHaveLength(0);
	});

	it('allows disabled for messaging — the staff switch-off for under-18 accounts', async () => {
		await setStanding({ userId: 'u1', scope: 'messaging', status: 'disabled', staffId: 'staff1' });
		expect(inserted[0].values).toMatchObject({ scope: 'messaging', status: 'disabled' });
	});

	it('trims a long staff note rather than storing it whole', async () => {
		await setStanding({
			userId: 'u1',
			scope: 'messaging',
			status: 'restricted',
			staffId: 'staff1',
			reason: 'x'.repeat(900)
		});
		expect((inserted[0].values as { reason: string }).reason).toHaveLength(500);
	});
});

describe('restrictStanding', () => {
	it('records the report that caused it, so the member can be told why', async () => {
		await restrictStanding({
			userId: 'u1',
			scope: 'community_event',
			flagId: 'f9',
			staffId: 'staff1',
			reason: 'Misleading listing'
		});

		expect(inserted[0].values).toMatchObject({
			userId: 'u1',
			scope: 'community_event',
			status: 'restricted',
			triggeringFlagId: 'f9',
			reason: 'Misleading listing'
		});
	});
});

describe('restoreStanding', () => {
	it('updates rather than inserting — restoring an unrestricted member is a no-op', async () => {
		await restoreStanding({ userId: 'u1', scope: 'suggestion', staffId: 'staff1' });
		expect(inserted).toHaveLength(0);
		expect(updated[0].table).toBe('member_standing');
	});

	// Flipping the status is what marks it forgiven. Wiping the reason and the
	// flag would make "why was I in review?" unanswerable afterwards.
	it('leaves the reason and the triggering report in place', async () => {
		await restoreStanding({ userId: 'u1', scope: 'suggestion', staffId: 'staff1' });
		expect(updated[0].set).toMatchObject({ status: 'none', updatedByUserId: 'staff1' });
		expect(updated[0].set).not.toHaveProperty('reason');
		expect(updated[0].set).not.toHaveProperty('triggeringFlagId');
	});

	it('restores one scope only', async () => {
		await restoreStanding({ userId: 'u1', scope: 'messaging', staffId: 'staff1' });
		expect(updated[0].where).toEqual({
			op: 'and',
			a: [
				{ op: 'eq', a: 'standing.userId', b: 'u1' },
				{ op: 'eq', a: 'standing.scope', b: 'messaging' }
			]
		});
	});
});

// The mapping `resolveFlag` used to carry inline, three branches deep. Pinned
// here directly because it is not the identity function and the exception is
// easy to lose in a refactor.
describe('scopeForFlag', () => {
	it('costs a member their listing standing only when the event is theirs to answer for', () => {
		expect(scopeForFlag('event', { eventSource: 'community' })).toBe('community_event');
	});

	it('spares a band gig — there is no member to hold responsible', () => {
		expect(scopeForFlag('event', { eventSource: 'band' })).toBeNull();
		expect(scopeForFlag('event', { eventSource: 'cmc' })).toBeNull();
		expect(scopeForFlag('event', {})).toBeNull();
	});

	it('maps suggestions and conversations to their own scopes', () => {
		expect(scopeForFlag('suggestion')).toBe('suggestion');
		expect(scopeForFlag('inbox_thread')).toBe('messaging');
	});

	it('costs nothing for a reported profile — staff act on the profile itself', () => {
		expect(scopeForFlag('member_profile')).toBeNull();
		expect(scopeForFlag('band_profile')).toBeNull();
	});
});
