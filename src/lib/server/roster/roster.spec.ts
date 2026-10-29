import { describe, it, expect, vi } from 'vitest';
import type { RosterPerson } from '$lib/types/roster';

// The real mapping reaches the finance/auth graph on import; only the roster's
// own decisions are under test here.
vi.mock('$lib/server/entity/refs', () => ({
	toMemberRef: (row: { id: string; name: string; email?: string | null }) => ({
		type: 'member',
		id: row.id,
		title: row.name,
		subtitle: row.email ?? null
	})
}));

import { allRosterRows, rosterCsv, rosterEmails, toRosterPerson } from './roster';

const person = (over: Partial<RosterPerson> = {}): RosterPerson => ({
	personId: 'u1',
	member: { type: 'member', id: 'u1', title: 'Robin Vale' },
	email: 'robin@example.com',
	memberStatus: 'member',
	...over
});

describe('toRosterPerson', () => {
	it('reads membership from `sustaining`, not from a staff position', () => {
		const staffWhoPays = { id: 'u1', name: 'A', role: 'staff', sustaining: 1 };
		expect(toRosterPerson(staffWhoPays).memberStatus).toBe('sustaining');
		expect(toRosterPerson({ id: 'u2', name: 'B', sustaining: 0 }).memberStatus).toBe('member');
	});

	it('keys the row on the user id and keeps a missing email null', () => {
		const p = toRosterPerson({ id: 'u3', name: 'C' });
		expect(p.personId).toBe('u3');
		expect(p.email).toBeNull();
	});
});

describe('rosterCsv', () => {
	it('puts the shared columns first, then the page columns in order', () => {
		const csv = rosterCsv(
			[{ ...person(), hours: 2 }],
			[{ header: 'hours', value: (r) => r.hours }]
		);
		const [header, row] = csv.trim().split('\n');
		expect(header).toBe('name,email,member_status,hours');
		expect(row).toBe('Robin Vale,robin@example.com,Member,2');
	});

	it('writes a blank cell for a null, not the word', () => {
		const csv = rosterCsv([person({ email: null })], [{ header: 'phone', value: () => null }]);
		expect(csv.trim().split('\n')[1]).toBe('Robin Vale,,Member,');
	});

	it('neutralises a member-authored name that would run as a formula', () => {
		const csv = rosterCsv([person({ member: { type: 'member', id: 'u1', title: '=cmd()' } })]);
		expect(csv).not.toMatch(/^=cmd/m);
	});
});

describe('rosterEmails', () => {
	it('drops people with no address and repeats differing only in case', () => {
		const rows = [
			person({ email: 'A@x.com' }),
			person({ email: null }),
			person({ email: 'a@x.com ' }),
			person({ email: 'b@x.com' })
		];
		expect(rosterEmails(rows)).toEqual(['A@x.com', 'b@x.com']);
	});
});

describe('allRosterRows', () => {
	it('walks every page, so an export is never capped at one', async () => {
		const all = Array.from({ length: 5 }, (_, i) => i);
		const list = vi.fn(async ({ page = 1, pageSize = 50 }) => ({
			rows: all.slice((page - 1) * pageSize, page * pageSize),
			pagination: {
				page,
				pageSize,
				total: all.length,
				totalPages: Math.ceil(all.length / pageSize)
			}
		}));

		expect(await allRosterRows(list, 2)).toEqual(all);
		expect(list).toHaveBeenCalledTimes(3);
	});
});
