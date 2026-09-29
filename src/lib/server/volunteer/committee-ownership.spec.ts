import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A duty list item names the committee answerable for it, a title and the fact
 * that says it is done (#1701), and applying the list copies all three onto the
 * work order. Against a real SQLite replayed from the migrations.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));

const { addDutyListItem, updateDutyListItem, applyDutyList, getDutyListDetail } =
	await import('./duty-list-service');

const T0 = 1_790_000_000;
const exec = (sql: string) => sqlite.exec(sql);

beforeEach(() => {
	for (const t of ['work_task', 'work_order', 'duty_list_item', 'duty_list', 'event_listing']) {
		exec(`delete from ${t}`);
	}
	exec(`delete from "group"`);
	exec(`delete from volunteer_role`);
	exec(`insert into volunteer_role (id, name) values ('role-lead', 'Booking Lead')`);
	exec(`insert into "group" (id, name, slug, kind) values
		('g-book', 'Booking Committee', 'booking-committee', 'committee'),
		('g-band', 'The Fuzz', 'the-fuzz', 'band')`);
	exec(`insert into "group" (id, name, slug, kind, deleted_at)
		values ('g-gone', 'Old Committee', 'old-committee', 'committee', ${T0})`);
	exec(
		`insert into duty_list (id, name, anchor, subject) values ('dl', 'Show deliverables', 'start', 'event')`
	);
	exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind)
		values ('evt', 'Friday', ${T0}, ${T0 + 7200}, 'u', 'cmc', 'show')`);
});

const item = (over: Record<string, unknown> = {}) =>
	addDutyListItem('dl', {
		volunteerRoleId: 'role-lead',
		dueOffsetMinutes: -40_320,
		capacity: 1,
		...over
	});

describe('an owning committee on a duty list item', () => {
	it('keeps the title, owner and done condition, and names the owner', async () => {
		await item({ title: 'Lineup confirmed', groupId: 'g-book', doneWhen: 'production_confirmed' });

		const detail = await getDutyListDetail('dl');
		expect(detail?.items[0]).toMatchObject({
			title: 'Lineup confirmed',
			groupId: 'g-book',
			groupName: 'Booking Committee',
			doneWhen: 'production_confirmed'
		});
	});

	it('leaves an item with no owner as staff’s', async () => {
		await item();
		const detail = await getDutyListDetail('dl');
		expect(detail?.items[0]).toMatchObject({ groupId: null, groupName: null, doneWhen: null });
	});

	it('refuses a band, a deleted committee and a group that does not exist', async () => {
		await expect(item({ groupId: 'g-band' })).rejects.toThrow(/committee/);
		await expect(item({ groupId: 'g-gone' })).rejects.toThrow(/committee/);
		await expect(item({ groupId: 'nope' })).rejects.toThrow(/committee/);
	});

	it('re-owns an item, and refuses a band there too', async () => {
		const row = await item({ groupId: 'g-book' });
		await updateDutyListItem(row.id, { groupId: null, title: '  Advance  ' });
		const [after] = (await getDutyListDetail('dl'))!.items;
		expect(after).toMatchObject({ groupId: null, title: 'Advance' });
		await expect(updateDutyListItem(row.id, { groupId: 'g-band' })).rejects.toThrow(/committee/);
	});
});

describe('applying a list with owned items', () => {
	it('copies the title, owner and done condition onto the work order', async () => {
		await item({ title: 'Lineup confirmed', groupId: 'g-book', doneWhen: 'production_confirmed' });
		await item({ sortOrder: 1 });

		const { workOrderIds } = await applyDutyList('dl', { kind: 'event', id: 'evt' }, null);

		const rows = sqlite
			.prepare(
				`select title, group_id as groupId, done_when as doneWhen, due_at as dueAt
				 from work_order where id in (${workOrderIds.map(() => '?').join(',')})
				 order by title is null`
			)
			.all(...workOrderIds);
		expect(rows).toEqual([
			{
				title: 'Lineup confirmed',
				groupId: 'g-book',
				doneWhen: 'production_confirmed',
				dueAt: T0 - 40_320 * 60
			},
			{ title: null, groupId: null, doneWhen: null, dueAt: T0 - 40_320 * 60 }
		]);
	});

	it('is a copy: re-owning the template leaves an applied show alone', async () => {
		const row = await item({ groupId: 'g-book' });
		await applyDutyList('dl', { kind: 'event', id: 'evt' }, null);
		await updateDutyListItem(row.id, { groupId: null });

		const [wo] = sqlite.prepare(`select group_id as groupId from work_order`).all();
		expect(wo).toEqual({ groupId: 'g-book' });
	});

	it('serves the open queue from the partial index', () => {
		const plan = sqlite
			.prepare(
				`explain query plan select id from work_order
				 where group_id = 'g-book' and resolved_at is null and cancelled_at is null
				 order by due_at`
			)
			.all() as { detail: string }[];
		expect(plan.map((p) => p.detail).join(' ')).toContain('work_order_group_open_idx');
	});
});
