import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { SHOW_DOCUMENTATION_ROLE_ID } from '$lib/config';

/**
 * Who may upload recap photos for one event (#1500): a holder of
 * `event.uploadRecap`, or a member staff confirmed on that event's
 * show-documentation work order. Another event's shift grants nothing.
 */

let rows: unknown[] = [];
let whereArg: SQL | null = null;
const chain: Record<string, unknown> = {};
for (const m of ['select', 'from', 'innerJoin', 'limit']) chain[m] = () => chain;
chain.where = (arg: SQL) => {
	whereArg = arg;
	return chain;
};
chain.then = (resolve: (v: unknown[]) => void) => resolve(rows);
vi.mock('$lib/server/db', () => ({ db: { select: () => chain } }));

let capable = false;
const can = vi.fn(async (_cap: string) => capable);
vi.mock('$lib/server/authorization', () => ({ can: (cap: string) => can(cap) }));

const { recapUploadAccess } = await import('./recap-access');
const render = () => new SQLiteSyncDialect().sqlToQuery(whereArg as SQL);

beforeEach(() => {
	rows = [];
	whereArg = null;
	capable = false;
	vi.clearAllMocks();
});

describe('recapUploadAccess', () => {
	it('lets a holder of event.uploadRecap upload to any event without a lookup', async () => {
		capable = true;
		expect(await recapUploadAccess('staff-1', 'e1')).toBe('capability');
		expect(whereArg).toBeNull();
	});

	it("lets a member confirmed on this event's show-documentation work order upload", async () => {
		rows = [{ id: 'signup-1' }];
		expect(await recapUploadAccess('member-1', 'e1')).toBe('photographer');
	});

	it('refuses a member with no such signup', async () => {
		expect(await recapUploadAccess('member-1', 'e1')).toBeNull();
	});

	it('refuses a signed-out caller without a lookup', async () => {
		expect(await recapUploadAccess(undefined, 'e1')).toBeNull();
		expect(can).not.toHaveBeenCalled();
	});

	it('scopes the signup to this event, this role, a live work order and staff-confirmed statuses', async () => {
		await recapUploadAccess('member-1', 'e1');
		const { sql, params } = render();
		expect(sql).toContain('"volunteer_signup"."user_id" = ?');
		expect(sql).toContain('"work_order"."event_id" = ?');
		expect(sql).toContain('"work_order"."volunteer_role_id" = ?');
		expect(sql).toContain('"work_order"."cancelled_at" is null');
		expect(sql).toContain('"volunteer_signup"."status" in (?, ?)');
		expect(params).toEqual(
			expect.arrayContaining([
				'member-1',
				'e1',
				SHOW_DOCUMENTATION_ROLE_ID,
				'confirmed',
				'completed'
			])
		);
		// A claim is the member putting a hand up; staff have not said yes yet.
		expect(params).not.toContain('claimed');
	});
});
