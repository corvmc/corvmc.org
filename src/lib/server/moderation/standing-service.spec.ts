import { describe, it, expect, vi, beforeEach } from 'vitest';

// Member standing against a real SQLite. Three rules carry the weight:
//   1. `(userId, scope)` is the key, not `userId`. An upheld report about a gig
//      listing must not put someone on probation for suggestions.
//   2. `scopeForFlag` is NOT the identity function — an `event` report only
//      costs standing when the event is a member's community listing.
//   3. Restoring is an UPDATE. Absence of a row means good standing, so
//      restoring someone who was never restricted must not insert one.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const {
	getStanding,
	getStandings,
	setStanding,
	restrictStanding,
	restoreStanding,
	scopeForFlag,
	StandingStatusNotAllowedError,
	StandingWithoutReportError
} = await import('./standing-service');

const T0 = 1_750_000_000;

function standing(userId: string, scope: string, status: string, reason: string | null = null) {
	sqlite
		.prepare(
			`insert into member_standing (user_id, scope, status, reason, triggering_flag_id, updated_by_user_id, updated_at)
			 values (?, ?, ?, ?, 'f1', 'staff0', ?)`
		)
		.run(userId, scope, status, reason, T0);
}

type Row = {
	user_id: string;
	scope: string;
	status: string;
	reason: string | null;
	triggering_flag_id: string | null;
	updated_by_user_id: string | null;
};
const rows = () =>
	sqlite.prepare('select * from member_standing order by user_id, scope').all() as Row[];
const rowFor = (userId: string, scope: string) =>
	sqlite
		.prepare('select * from member_standing where user_id = ? and scope = ?')
		.get(userId, scope) as Row | undefined;

beforeEach(() => {
	sqlite.exec('delete from member_standing');
});

describe('getStanding', () => {
	it('treats an absent row as good standing — the case every reader assumes', async () => {
		await expect(getStanding('u1', 'suggestion')).resolves.toEqual({
			status: 'none',
			reason: null,
			triggeringFlagId: null,
			updatedAt: null
		});
	});

	it('reads the stored row when there is one', async () => {
		standing('u1', 'suggestion', 'restricted', 'Spam');
		await expect(getStanding('u1', 'suggestion')).resolves.toEqual({
			status: 'restricted',
			reason: 'Spam',
			triggeringFlagId: 'f1',
			updatedAt: new Date(T0 * 1000)
		});
	});

	// The point of the whole table: being on review for gig listings says
	// nothing about suggestions.
	it('narrows on the scope as well as the member', async () => {
		standing('u1', 'community_event', 'restricted');
		standing('u2', 'messaging', 'disabled');

		expect((await getStanding('u1', 'messaging')).status).toBe('none');
		expect((await getStanding('u1', 'community_event')).status).toBe('restricted');
	});
});

describe('getStandings', () => {
	it('fills in every scope, defaulting the absent ones, for this member only', async () => {
		standing('u1', 'suggestion', 'restricted', 'Spam');
		standing('u2', 'messaging', 'disabled');

		const all = await getStandings('u1');

		expect(Object.keys(all).sort()).toEqual([
			'classified',
			'community_event',
			'messaging',
			'suggestion'
		]);
		expect(all.suggestion.status).toBe('restricted');
		expect(all.community_event.status).toBe('none');
		expect(all.messaging.status).toBe('none');
	});
});

describe('setStanding', () => {
	it('upserts on the composite key, so a second upheld report restates rather than fails', async () => {
		const base = {
			userId: 'u1',
			scope: 'suggestion' as const,
			status: 'restricted' as const,
			staffId: 'staff1'
		};
		standing('u1', 'messaging', 'restricted', 'other scope');

		await setStanding({ ...base, reason: 'Spam', flagId: 'f1' });
		await setStanding({ ...base, reason: 'More spam', flagId: 'f2' });

		expect(rows()).toHaveLength(2);
		expect(rowFor('u1', 'suggestion')).toMatchObject({
			status: 'restricted',
			reason: 'More spam',
			triggering_flag_id: 'f2',
			updated_by_user_id: 'staff1'
		});
		expect(rowFor('u1', 'messaging')?.reason).toBe('other scope');
	});

	// Only messaging has a use for `disabled`; storing it elsewhere would leave a
	// value in the column that no reader knows how to interpret.
	it('refuses a status the scope has no meaning for', async () => {
		await expect(
			setStanding({
				userId: 'u1',
				scope: 'suggestion',
				status: 'disabled',
				staffId: 'staff1',
				flagId: 'f1'
			})
		).rejects.toBeInstanceOf(StandingStatusNotAllowedError);
		expect(rows()).toHaveLength(0);
	});

	// `disabled` is the escalation past reply-only `restricted`; it used to
	// double as the under-18 switch-off, which #556 moved to `user.date_of_birth`.
	it('allows disabled for messaging — the escalation past reply-only', async () => {
		await setStanding({
			userId: 'u1',
			scope: 'messaging',
			status: 'disabled',
			staffId: 'staff1',
			flagId: 'f1'
		});
		expect(rowFor('u1', 'messaging')?.status).toBe('disabled');
	});

	it('trims a long staff note rather than storing it whole', async () => {
		await setStanding({
			userId: 'u1',
			scope: 'messaging',
			status: 'restricted',
			staffId: 'staff1',
			reason: 'x'.repeat(900),
			flagId: 'f1'
		});
		expect(rowFor('u1', 'messaging')?.reason).toHaveLength(500);
	});

	// Every moderation action is an upheld report: with no report there is
	// nothing to appeal.
	it('rejects a standing with no report behind it', async () => {
		await expect(
			setStanding({
				userId: 'u1',
				scope: 'messaging',
				status: 'restricted',
				staffId: 'staff1',
				flagId: undefined as unknown as string
			})
		).rejects.toBeInstanceOf(StandingWithoutReportError);
		expect(rows()).toHaveLength(0);
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

		expect(rowFor('u1', 'community_event')).toMatchObject({
			status: 'restricted',
			triggering_flag_id: 'f9',
			reason: 'Misleading listing'
		});
	});
});

describe('restoreStanding', () => {
	it('updates rather than inserting — restoring an unrestricted member is a no-op', async () => {
		await restoreStanding({ userId: 'u1', scope: 'suggestion', staffId: 'staff1' });
		expect(rows()).toHaveLength(0);
	});

	// Flipping the status is what marks it forgiven. Wiping the reason and the
	// flag would make "why was I in review?" unanswerable afterwards.
	it('leaves the reason and the triggering report in place', async () => {
		standing('u1', 'suggestion', 'restricted', 'Spam');

		await restoreStanding({ userId: 'u1', scope: 'suggestion', staffId: 'staff1' });

		expect(rowFor('u1', 'suggestion')).toMatchObject({
			status: 'none',
			updated_by_user_id: 'staff1',
			reason: 'Spam',
			triggering_flag_id: 'f1'
		});
	});

	it('restores one scope of one member only', async () => {
		standing('u1', 'messaging', 'restricted');
		standing('u1', 'suggestion', 'restricted');
		standing('u2', 'messaging', 'restricted');

		await restoreStanding({ userId: 'u1', scope: 'messaging', staffId: 'staff1' });

		expect(rows().map((r) => `${r.user_id}/${r.scope}=${r.status}`)).toEqual([
			'u1/messaging=none',
			'u1/suggestion=restricted',
			'u2/messaging=restricted'
		]);
	});
});

// Not the identity function, and the exception is easy to lose in a refactor.
describe('scopeForFlag', () => {
	it('costs a member their listing standing only when the event is theirs to answer for', () => {
		expect(scopeForFlag('event', { eventSource: 'community' })).toBe('community_event');
	});

	it('spares a band gig — there is no member to hold responsible', () => {
		expect(scopeForFlag('event', { eventSource: 'band' })).toBeNull();
		expect(scopeForFlag('event', { eventSource: 'cmc' })).toBeNull();
		expect(scopeForFlag('event', {})).toBeNull();
	});

	it('spares a listing a partner feed imported — its author did not write the show', () => {
		expect(scopeForFlag('event', { eventSource: 'community', imported: true })).toBeNull();
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
