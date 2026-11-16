import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Assigning and removing one position (#1942), against a real SQLite: the
 * last-admin count and the role-row upsert are SQL a mock would wave through.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('$app/server', () => ({ getRequestEvent: () => ({ locals: {} }) }));
const recordAuditEntry = vi.fn(async (_entry: unknown) => undefined);
vi.mock('#lib/server/audit/audit-service.js', () => ({
	recordAuditEntry: (entry: unknown) => recordAuditEntry(entry)
}));

const { setPosition, positionChangeRefusal, PositionChangeRefusedError } =
	await import('./position-service');
const { role, modelHasRole } = await import('#lib/server/db/schema/authorization.js');
const { user } = await import('#lib/server/db/schema/authentication.js');
const { getUserRoles, positionsFor } = await import('#lib/server/authorization.js');

/** Each Operations seat: who holds which job. */
const seats = () =>
	sqlite
		.prepare(
			`select gm.user_id as userId, gp.job from group_position_holder h
			join group_position gp on gp.id = h.position_id
			join group_member gm on gm.id = h.member_id
			where gp.group_id = 'operations' order by 1, 2`
		)
		.all();

beforeEach(async () => {
	for (const t of ['group_position_holder', 'group_member', 'model_has_roles', 'roles', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	recordAuditEntry.mockClear();
	await testDb.insert(user).values(
		['ada', 'bo'].map((n) => ({
			id: `u-${n}`,
			name: n.toUpperCase(),
			email: `${n}@example.com`,
			emailVerified: false
		})) as never
	);
	await testDb.insert(role).values([
		{ id: 1, name: 'admin' },
		{ id: 2, name: 'staff' }
	] as never);
	await testDb.insert(modelHasRole).values([{ roleId: 1, userId: 'u-ada' }]);
});

describe('setPosition', () => {
	it('assigns a job as an Operations seat, and records it like the profile form', async () => {
		const change = await setPosition({
			actorId: 'u-ada',
			targetId: 'u-bo',
			position: 'treasurer',
			held: true
		});
		expect(change).toEqual({ added: ['treasurer'], removed: [] });
		expect(await getUserRoles('u-bo')).toEqual(['treasurer']);
		expect(await positionsFor('u-bo')).toEqual(['treasurer']);
		expect(seats()).toEqual([{ userId: 'u-bo', job: 'treasurer' }]);
		expect(
			sqlite.prepare(`select count(*) as n from model_has_roles where user_id = 'u-bo'`).get()
		).toEqual({ n: 0 });
		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'user.roles_changed',
			subject: { type: 'user', id: 'u-bo', label: 'BO' },
			details: { added: ['treasurer'], removed: [] }
		});
	});

	it('takes a job away by vacating the seat, leaving the other seats', async () => {
		await setPosition({ actorId: 'u-ada', targetId: 'u-bo', position: 'treasurer', held: true });
		await setPosition({ actorId: 'u-ada', targetId: 'u-bo', position: 'auditor', held: true });
		await setPosition({ actorId: 'u-ada', targetId: 'u-bo', position: 'treasurer', held: false });
		expect(await positionsFor('u-bo')).toEqual(['auditor']);
		expect(seats()).toEqual([{ userId: 'u-bo', job: 'auditor' }]);
	});

	it('grants nothing from a job name left in model_has_roles', async () => {
		await testDb.insert(modelHasRole).values([{ roleId: 2, userId: 'u-bo' }]);
		expect(await positionsFor('u-bo')).toEqual([]);
	});

	it('is a no-op, recording nothing, when nothing changes', async () => {
		await setPosition({ actorId: 'u-ada', targetId: 'u-bo', position: 'staff', held: false });
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});

	it('refuses to remove the last admin', async () => {
		await setPosition({ actorId: 'u-ada', targetId: 'u-bo', position: 'staff', held: true });
		await expect(
			setPosition({ actorId: 'u-bo', targetId: 'u-ada', position: 'admin', held: false })
		).rejects.toMatchObject({ httpStatus: 409 });
		expect(await getUserRoles('u-ada')).toEqual(['admin']);
	});

	it('removes an admin while another remains', async () => {
		await setPosition({ actorId: 'u-ada', targetId: 'u-bo', position: 'admin', held: true });
		await setPosition({ actorId: 'u-bo', targetId: 'u-ada', position: 'admin', held: false });
		expect(await getUserRoles('u-ada')).toEqual([]);
	});
});

describe('positionChangeRefusal', () => {
	it('refuses dropping your own last position', async () => {
		const refusal = await positionChangeRefusal({
			actorId: 'u-bo',
			targetId: 'u-bo',
			current: ['staff', 'member'],
			next: ['member']
		});
		expect(refusal).toBeInstanceOf(PositionChangeRefusedError);
		expect(refusal?.httpStatus).toBe(400);
	});

	it('lets you swap one of your positions for another', async () => {
		expect(
			await positionChangeRefusal({
				actorId: 'u-bo',
				targetId: 'u-bo',
				current: ['staff'],
				next: ['treasurer']
			})
		).toBeNull();
	});
});
