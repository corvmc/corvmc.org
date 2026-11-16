import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Template items that wait on others (#2625), against the real migrated
 * schema: the grant application ships in its natural order, a loop between
 * items is refused, and applying a template copies its edges onto the tasks.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({
	db: testDb,
	getRowCount: () => 0
}));

const svc = await import('./duty-list-service');

const all = <T>(query: string) => sqlite.prepare(query).all() as T[];

describe('the grant application template', () => {
	it('ships in its natural order: narrative, then budget, then submit', () => {
		const edges = all<{ item: string; waits_on: string }>(`
			SELECT a.title AS item, b.title AS waits_on
			FROM duty_list_item_dependency d
			JOIN duty_list_item a ON a.id = d.item_id
			JOIN duty_list_item b ON b.id = d.depends_on_item_id
			JOIN duty_list dl ON dl.id = a.duty_list_id AND dl.grant_stage = 'application'
			ORDER BY a.title, b.title
		`);
		expect(edges).toEqual([
			{ item: 'Build the budget', waits_on: 'Draft the narrative' },
			{ item: 'Submit the application', waits_on: 'Build the budget' },
			{ item: 'Submit the application', waits_on: 'Collect letters of support' }
		]);
	});
});

describe('item dependencies', () => {
	beforeEach(() => {
		for (const t of [
			'audit_log',
			'work_order_dependency',
			'work_task',
			'volunteer_shift',
			'work_order',
			'duty_list_item_dependency',
			'duty_list_item',
			'duty_list',
			'project_section',
			'project'
		]) {
			sqlite.exec(`DELETE FROM ${t}`);
		}
		sqlite.exec(`DELETE FROM volunteer_role WHERE id LIKE 'role-%'`);
		sqlite.exec(`DELETE FROM user WHERE id = 'u1'`);
		sqlite.exec(`
			INSERT INTO user (id, name, email, email_verified) VALUES ('u1','Coord','c@example.com',1);
			INSERT INTO volunteer_role (id, name) VALUES ('role-1','Writer');
			INSERT INTO project (id, name, starts_at) VALUES ('proj-1', 'Grant', ${Math.floor(Date.UTC(2030, 0, 1) / 1000)});
			INSERT INTO duty_list (id, name, anchor, subject) VALUES
				('dl-1','Steps','project_start','project'), ('dl-2','Other','project_start','project');
			INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, due_offset_minutes, title) VALUES
				('a','dl-1','role-1', 0, 'Narrative'),
				('b','dl-1','role-1', 60, 'Budget'),
				('c','dl-1','role-1', 120, 'Submit'),
				('x','dl-2','role-1', 0, 'Elsewhere');
		`);
	});

	it('refuses a loop between items, direct or through another, and an item on another template', async () => {
		await svc.addItemDependency('b', 'a');
		await svc.addItemDependency('c', 'b');
		await expect(svc.addItemDependency('a', 'c')).rejects.toBeInstanceOf(
			svc.DutyListValidationError
		);
		await expect(svc.addItemDependency('a', 'b')).rejects.toBeInstanceOf(
			svc.DutyListValidationError
		);
		await expect(svc.addItemDependency('c', 'x')).rejects.toBeInstanceOf(
			svc.DutyListValidationError
		);
		expect(all(`SELECT 1 FROM duty_list_item_dependency`)).toHaveLength(2);

		const detail = await svc.getDutyListDetail('dl-1');
		expect(Object.fromEntries(detail!.items.map((i) => [i.id, i.waitsOn]))).toEqual({
			a: [],
			b: ['a'],
			c: ['b']
		});
	});

	it('copies the edges onto the tasks a template stamps', async () => {
		await svc.addItemDependency('b', 'a');
		await svc.addItemDependency('c', 'b');
		await svc.applyDutyList('dl-1', { kind: 'project', id: 'proj-1' }, 'u1');

		const edges = all<{ task: string; waits_on: string }>(`
			SELECT a.title AS task, b.title AS waits_on
			FROM work_order_dependency d
			JOIN work_order a ON a.id = d.work_order_id
			JOIN work_order b ON b.id = d.depends_on_id
			ORDER BY a.title
		`);
		expect(edges).toEqual([
			{ task: 'Budget', waits_on: 'Narrative' },
			{ task: 'Submit', waits_on: 'Budget' }
		]);
	});

	it('removes an edge', async () => {
		await svc.addItemDependency('b', 'a');
		await svc.removeItemDependency('b', 'a');
		expect(all(`SELECT 1 FROM duty_list_item_dependency`)).toHaveLength(0);
	});
});
