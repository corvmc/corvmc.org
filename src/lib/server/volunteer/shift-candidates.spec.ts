import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * The "who to ask" shortlist, ranked by skill tags (#1445): a member whose
 * skills cover the role's list ranks above one who only ticked the role, and
 * the matched skills come back for the flag line. Informative, never a gate.
 */

let rows: unknown[] = [];
let orderByArgs: unknown[] = [];

function chain(): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(rows);
			if (prop === 'orderBy') {
				return (...args: unknown[]) => {
					orderByArgs = args;
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({ db: { select: vi.fn(() => chain()) } }));
vi.mock('$lib/server/authorization', () => ({ topPositionFor: vi.fn(() => null) }));

const { listShiftCandidates } = await import('./volunteer-signup-service');

const render = (q: unknown) => new SQLiteSyncDialect().sqlToQuery(q as SQL);

const member = { id: 'u-1', name: 'Ada', email: 'ada@x.example' };

beforeEach(() => {
	rows = [];
	orderByArgs = [];
});

describe('listShiftCandidates skill ranking', () => {
	it('returns the skills that matched the role, and none when nothing did', async () => {
		rows = [
			{
				userId: 'u-1',
				member,
				availability: null,
				approvedMinutes: 0,
				workedThisRole: 0,
				matchedSkills: 'live sound|sound engineer'
			},
			{
				userId: 'u-2',
				member,
				availability: null,
				approvedMinutes: 0,
				workedThisRole: 0,
				matchedSkills: null
			}
		];

		const out = await listShiftCandidates('shift-1', 'role-1', 'all');

		expect(out[0].matchedSkills).toEqual(['live sound', 'sound engineer']);
		expect(out[1].matchedSkills).toEqual([]);
	});

	it('ranks on skill matches after role history, against the role list', async () => {
		await listShiftCandidates('shift-1', 'role-1', 'interested');

		expect(orderByArgs).toHaveLength(3);
		const { sql, params } = render(orderByArgs[1]);
		expect(sql).toContain('"directory_tag"');
		expect(sql).toContain('json_each');
		expect(sql).toContain('"skill_matches"');
		expect(params).toContain('skill');
		expect(params).toContain('role-1');
	});
});
