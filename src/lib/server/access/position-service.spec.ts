import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Assigning and removing one position (#1942), against a real SQLite: the
 * last-admin count and the role-row upsert are SQL a mock would wave through.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$app/server', () => ({ getRequestEvent: () => ({ locals: {} }) }));
const recordAuditEntry = vi.fn(async (_entry: unknown) => undefined);
vi.mock('$lib/server/audit/audit-service', () => ({
	recordAuditEntry: (entry: unknown) => recordAuditEntry(entry)
}));

const { setPosition, positionChangeRefusal, PositionChangeRefusedError } =
	await import('./position-service');
const { role, modelHasRole } = await import('$lib/server/db/schema/authorization');
const { user } = await import('$lib/server/db/schema/authentication');
const { getUserRoles } = await import('$lib/server/authorization');

beforeEach(async () => {
	for (const t of ['model_has_roles', 'roles', 'user']) sqlite.exec(`delete from ${t}`);
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
	it('assigns a position, creating its roles row, and records it like the profile form', async () => {
		const change = await setPosition({
			actorId: 'u-ada',
			targetId: 'u-bo',
			position: 'treasurer',
			held: true
		});
		expect(change).toEqual({ added: ['treasurer'], removed: [] });
		expect(await getUserRoles('u-bo')).toEqual(['treasurer']);
		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'user.roles_changed',
			subject: { type: 'user', id: 'u-bo', label: 'BO' },
			details: { added: ['treasurer'], removed: [] }
		});
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
