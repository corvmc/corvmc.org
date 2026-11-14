import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tagging a task for a department position (#2990), against a real SQLite: the
 * position must be one of the task's own committee's, and the choices offered
 * are exactly those.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
const audit = vi.fn(async (..._a: unknown[]) => {});
vi.mock('#lib/server/audit/audit-service.js', () => ({
	recordAuditEntry: (...a: unknown[]) => audit(...a)
}));

const { setTaskPosition, taskPositionChoices, TaskPositionError } = await import('./task-position');

const positionOf = (id: string) =>
	(
		sqlite.prepare('select position_id as p from work_order where id = ?').get(id) as {
			p: string | null;
		}
	).p;

beforeEach(() => {
	audit.mockClear();
	sqlite.exec(`
		delete from work_order; delete from group_position; delete from "group";
		insert into "group" (id, kind, name, slug, join_policy) values
			('booking', 'committee', 'Booking', 'booking', 'invite_only'),
			('sound', 'committee', 'Sound', 'sound', 'invite_only');
		insert into group_position (id, group_id, name, is_chair) values
			('chair', 'booking', 'Chair', 1), ('treasurer', 'booking', 'Treasurer', 0),
			('engineer', 'sound', 'Engineer', 0);
		insert into work_order (id, title, group_id) values
			('task', 'Book acts', 'booking'), ('staff-task', 'Staff work', null);
	`);
});

describe('setTaskPosition', () => {
	it("tags a task for one of its committee's positions, and clears it", async () => {
		await setTaskPosition('task', 'treasurer');
		expect(positionOf('task')).toBe('treasurer');
		expect(audit).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'work_order.edited', details: { fields: ['position'] } })
		);
		await setTaskPosition('task', null);
		expect(positionOf('task')).toBeNull();
	});

	it("refuses another committee's position", async () => {
		await expect(setTaskPosition('task', 'engineer')).rejects.toBeInstanceOf(TaskPositionError);
		expect(positionOf('task')).toBeNull();
	});

	it('refuses a position on a task no committee owns', async () => {
		await expect(setTaskPosition('staff-task', 'treasurer')).rejects.toBeInstanceOf(
			TaskPositionError
		);
	});

	it('records nothing when the position is unchanged', async () => {
		await setTaskPosition('task', null);
		expect(audit).not.toHaveBeenCalled();
	});
});

describe('taskPositionChoices', () => {
	it("offers the task's committee's positions, the chair first", async () => {
		const choices = await taskPositionChoices('task');
		expect(choices?.options.map((o) => o.id)).toEqual(['chair', 'treasurer']);
		expect(choices?.positionId).toBeNull();
	});

	it('offers nothing on a task no committee owns', async () => {
		expect((await taskPositionChoices('staff-task'))?.options).toEqual([]);
	});
});
