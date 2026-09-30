import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The committee's Open items and the show's Deliverables card (#1701), against
 * a real SQLite replayed from the migrations.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});
vi.mock('$lib/server/db', () => ({ db: testDb, getRowCount: () => 0 }));
vi.mock('$lib/server/production/run-of-show-service', () => ({ recomputeSetTimes: vi.fn() }));
vi.mock('$lib/server/finance/production-expense-entries', () => ({
	postProductionExpenses: vi.fn()
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const svc = await import('./deliverables-service');

const T0 = 1_790_000_000;
const DAY = 86_400;
const exec = (sql: string) => sqlite.exec(sql);

beforeEach(() => {
	for (const t of [
		'volunteer_signup',
		'work_task',
		'work_order',
		'media_attachment',
		'media',
		'artifact_request',
		'directory_entry',
		'event_listing',
		'group_member'
	])
		exec(`delete from ${t}`);
	exec(`delete from "group"`);
	exec(`insert or ignore into volunteer_role (id, name) values ('r', 'Spec Role')`);
	exec(
		`insert or ignore into user (id, name, email, email_verified) values ('u1', 'Ada', 'a@x.test', 1)`
	);
	exec(`insert into "group" (id, name, slug, kind) values
		('art', 'Art and Merchandise Committee', 'art', 'committee'),
		('book', 'Booking Committee', 'book', 'committee'),
		('band', 'A Band', 'a-band', 'band')`);
	exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, status)
		values ('evt', 'Friday', ${T0}, ${T0 + 7200}, 'u1', 'cmc', 'show', 'draft')`);
});

function wo(id: string, cols: Record<string, string | number | null>) {
	const all = { volunteer_role_id: 'r', event_id: 'evt', ...cols };
	const keys = Object.keys(all);
	const vals = Object.values(all).map((v) =>
		v === null ? 'null' : typeof v === 'number' ? v : `'${v}'`
	);
	exec(`insert into work_order (id, ${keys.join(', ')}) values ('${id}', ${vals.join(', ')})`);
}

describe('listCommitteeOpenItems', () => {
	it('lists the committee’s open and overdue items, soonest due first, with who has them', async () => {
		wo('late', {
			group_id: 'art',
			title: 'Poster art made',
			done_when: 'poster_set',
			due_at: T0 - 30 * DAY
		});
		wo('soon', { group_id: 'art', title: 'Flyers', due_at: T0 - 20 * DAY });
		wo('other', { group_id: 'book', title: 'Not ours', due_at: T0 - 40 * DAY });
		wo('gone', { group_id: 'art', title: 'Called off', cancelled_at: T0 });
		wo('closed', { group_id: 'art', title: 'Resolved', resolved_at: T0 });
		exec(
			`insert into volunteer_signup (id, shift_id, user_id, status) values ('s', 'soon', 'u1', 'confirmed')`
		);

		const rows = await svc.listCommitteeOpenItems('art');
		expect(rows.map((r) => [r.id, r.state, r.assignees.map((a) => a.name)])).toEqual([
			['late', 'overdue', []],
			['soon', 'overdue', ['Ada']]
		]);
		expect(rows[0]).toMatchObject({
			title: 'Poster art made',
			eventTitle: 'Friday',
			groupName: 'Art and Merchandise Committee'
		});
	});

	it('leaves out an item its show already satisfies, and counts it as unfinished until resolved', async () => {
		wo('desc', { group_id: 'book', done_when: 'description_set', due_at: T0 });
		exec(`update event_listing set description = 'Three bands'`);
		expect(await svc.listCommitteeOpenItems('book')).toEqual([]);
		expect(await svc.countCommitteeUnfinished('book')).toBe(1);
	});

	it('falls back to the role’s name for an untitled item', async () => {
		wo('bare', { group_id: 'art' });
		const [row] = await svc.listCommitteeOpenItems('art');
		expect(row.title).toBe('Spec Role');
	});
});

describe('listShowDeliverables', () => {
	it('shows every deliverable on the show, done and cancelled too, and no crew shifts', async () => {
		wo('a', { group_id: 'art', due_at: T0 });
		wo('b', { group_id: 'book', resolved_at: T0 });
		wo('c', { group_id: null, done_when: 'event_published' });
		wo('crew', { starts_at: T0, ends_at: T0 + 3600 });
		const rows = await svc.listShowDeliverables('evt');
		expect(rows.map((r) => [r.id, r.state]).sort()).toEqual(
			[
				['a', 'overdue'],
				['b', 'done'],
				['c', 'open']
			].sort()
		);
	});

	it('says the art is waiting for its use once it has been delivered and the show has no poster', async () => {
		wo('poster', { group_id: 'art', done_when: 'poster_set', due_at: T0 });
		exec(`insert into directory_entry (id, name) values ('artist', 'An Artist')`);
		exec(
			`insert into artifact_request (id, event_id, entry_id, artifact) values ('ask', 'evt', 'artist', 'poster_art')`
		);
		expect((await svc.listShowDeliverables('evt'))[0].artAwaitingUse).toBe(false);

		exec(
			`insert into media (id, key, content_type, byte_size) values ('m', 'art/a.png', 'image/png', 1)`
		);
		exec(`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			values ('ma', 'm', 'artifact_request', 'ask', 'poster')`);
		expect((await svc.listShowDeliverables('evt'))[0].artAwaitingUse).toBe(true);

		exec(`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			values ('mb', 'm', 'event_listing', 'evt', 'poster')`);
		const [row] = await svc.listShowDeliverables('evt');
		expect([row.state, row.artAwaitingUse]).toEqual(['done', false]);
	});
});

describe('reassignDeliverable', () => {
	it('hands an open item to another committee, or back to staff', async () => {
		wo('x', { group_id: 'art' });
		await svc.reassignDeliverable('x', 'book');
		expect(await svc.getDeliverableOwner('x')).toMatchObject({ groupId: 'book' });
		await svc.reassignDeliverable('x', null);
		expect(await svc.getDeliverableOwner('x')).toMatchObject({ groupId: null });
	});

	it('refuses a band, and an item that is already closed', async () => {
		wo('x', { group_id: 'art' });
		wo('shut', { group_id: 'art', resolved_at: T0 });
		await expect(svc.reassignDeliverable('x', 'band')).rejects.toThrow(/committee/);
		await expect(svc.reassignDeliverable('shut', 'book')).rejects.toThrow(/not open/);
	});
});
