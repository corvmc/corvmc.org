import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A project's Activity, against a real SQLite: which audit rows belong to a
 * project is a subquery and a join, and the merge with ticks and the origin
 * chain is ordering a mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { listActivity, activityAuditQuery } = await import('./project-activity');

const PROJECT = 'proj-1';
const OTHER = 'proj-2';
const STAFF = 'usr-staff';
const ADA = 'usr-ada';
const T0 = 1_900_000_000;

function insert(table: string, row: Record<string, unknown>) {
	const keys = Object.keys(row);
	sqlite
		.prepare(
			`insert into ${table} (${keys.map((k) => `"${k}"`).join(', ')})
				values (${keys.map(() => '?').join(', ')})`
		)
		.run(...keys.map((k) => row[k]));
}

let seq = 0;
function audit(
	subjectType: string,
	subjectId: string,
	action: string,
	at: number,
	details: Record<string, unknown> = {}
) {
	insert('audit_log', {
		id: `a-${++seq}`,
		action,
		actor_user_id: STAFF,
		actor_name: 'Sam Staff',
		actor_email: 'sam@example.com',
		subject_type: subjectType,
		subject_id: subjectId,
		details: JSON.stringify(details),
		created_at: at
	});
}

beforeEach(() => {
	seq = 0;
	for (const t of [
		'audit_log',
		'work_task',
		'work_order',
		'ballot',
		'suggestion',
		'project',
		'user'
	]) {
		sqlite.exec(`delete from "${t}"`);
	}
	insert('user', { id: STAFF, name: 'Sam Staff', email: 's@example.com', email_verified: 0 });
	insert('user', { id: ADA, name: 'Ada', email: 'a@example.com', email_verified: 0 });
	insert('project', { id: PROJECT, name: 'Renovation', created_at: T0, created_by_user_id: STAFF });
	insert('project', { id: OTHER, name: 'Other', created_at: T0 });
	insert('work_order', { id: 'wo-1', project_id: PROJECT, title: 'Paint', capacity: 1 });
	insert('work_order', { id: 'wo-2', project_id: PROJECT, title: 'Sand', capacity: 1 });
	insert('work_order', { id: 'wo-x', project_id: OTHER, title: 'Elsewhere', capacity: 1 });
});

const summaries = (items: { summary: string }[]) => items.map((i) => i.summary);

describe('a project', () => {
	it("merges the project's entries, its work orders' and their ticks, newest first", async () => {
		audit('project', PROJECT, 'project.edited', T0 + 10, { fields: ['budget'] });
		audit('work_order', 'wo-1', 'work_order.cancelled', T0 + 30);
		audit('work_order', 'wo-x', 'work_order.cancelled', T0 + 40);
		audit('project', OTHER, 'project.edited', T0 + 50, { fields: ['name'] });
		insert('work_task', {
			id: 'wt-1',
			work_order_id: 'wo-2',
			label: 'Tape the trim',
			done: 1,
			done_at: T0 + 20,
			done_by_user_id: ADA
		});

		const { items, hasMore } = await listActivity({ projectId: PROJECT });

		expect(summaries(items)).toEqual([
			'Called it off',
			'Ticked “Tape the trim”',
			"Edited the project's budget",
			'Started the project'
		]);
		expect(items[0].task).toEqual({ id: 'wo-1', title: 'Paint' });
		expect(items[1]).toMatchObject({ actorName: 'Ada', task: { id: 'wo-2', title: 'Sand' } });
		expect(items[2].task).toBeNull();
		expect(hasMore).toBe(false);
	});

	it('reads the origin chain from the suggestion, the ballots and the project', async () => {
		insert('suggestion', {
			id: 'sug-1',
			author_user_id: ADA,
			title: 'Repaint the hall',
			body: 'It is peeling',
			created_at: T0 - 300
		});
		insert('ballot', {
			id: 'bal-1',
			kind: 'member',
			title: 'Repaint?',
			suggestion_id: 'sug-1',
			closes_at: T0 - 50,
			created_by_id: STAFF,
			opened_at: T0 - 200,
			certified_at: T0 - 40,
			certifier_id: STAFF,
			passed: 1
		});
		// A draft never opened is not part of the story.
		insert('ballot', {
			id: 'bal-2',
			kind: 'member',
			title: 'Draft',
			closes_at: T0,
			project_id: PROJECT
		});
		sqlite.exec(
			`update project set suggestion_id = 'sug-1', ballot_id = 'bal-1' where id = '${PROJECT}'`
		);

		const { items } = await listActivity({ projectId: PROJECT });

		expect(summaries(items)).toEqual([
			'Started the project',
			'Certified “Repaint?”: passed',
			'Put “Repaint?” to a ballot',
			'Suggested “Repaint the hall”'
		]);
		expect(items.at(-1)).toMatchObject({
			actorName: 'Ada',
			origin: { kind: 'suggestion', id: 'sug-1' }
		});
		expect(items[1].origin).toEqual({ kind: 'ballot', id: 'bal-1' });
	});

	it('pages by limit and says when there is more', async () => {
		for (let i = 0; i < 5; i++) audit('work_order', 'wo-1', 'work_order.reopened', T0 + 100 + i);

		const first = await listActivity({ projectId: PROJECT }, { limit: 3 });
		const all = await listActivity({ projectId: PROJECT }, { limit: 10 });

		expect(first.items).toHaveLength(3);
		expect(first.hasMore).toBe(true);
		expect(all.items).toHaveLength(6);
		expect(all.hasMore).toBe(false);
		expect(all.items.slice(0, 3).map((i) => i.id)).toEqual(first.items.map((i) => i.id));
	});

	// D1 caps a statement at 100 bound parameters; the work orders are a subquery.
	it('binds the same few parameters however many work orders the project has', async () => {
		for (let i = 0; i < 150; i++) {
			insert('work_order', {
				id: `bulk-${i}`,
				project_id: PROJECT,
				title: `Bulk ${i}`,
				capacity: 1
			});
			audit('work_order', `bulk-${i}`, 'work_order.reopened', T0 + 1000 + i);
		}

		const { items, hasMore } = await listActivity({ projectId: PROJECT }, { limit: 200 });

		expect(items.filter((i) => i.task?.title.startsWith('Bulk'))).toHaveLength(150);
		expect(hasMore).toBe(false);
		expect(activityAuditQuery({ projectId: PROJECT }, 201).toSQL().params.length).toBeLessThan(10);
	});
});

describe('one work order', () => {
	it('reads only its own entries and ticks, with no origin chain', async () => {
		audit('work_order', 'wo-1', 'work_order.reopened', T0 + 10);
		audit('work_order', 'wo-2', 'work_order.cancelled', T0 + 20);
		audit('project', PROJECT, 'project.edited', T0 + 30, { fields: ['name'] });
		insert('work_task', {
			id: 'wt-1',
			work_order_id: 'wo-1',
			label: 'Buy paint',
			done: 1,
			done_at: T0 + 5,
			done_by_user_id: ADA
		});

		const { items } = await listActivity({ workOrderId: 'wo-1' });

		expect(summaries(items)).toEqual(['Reopened it', 'Ticked “Buy paint”']);
	});
});
