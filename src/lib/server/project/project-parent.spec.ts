import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A festival or run is a parent project over its show projects (#2543). Its
 * burn is a sum across rows and its depth rule reads other rows, so both run
 * against a real SQLite replayed from the migrations.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/volunteer/hour-value.js', () => ({ getHourValueCents: async () => 3000 }));
vi.mock('#lib/server/audit/audit-service.js', () => ({ recordAuditEntry: async () => undefined }));

const { getProjectBurn, getProjectFamily, updateProject, createProject, ProjectParentError } =
	await import('./project-service');

const exec = (sql: string) => sqlite.exec(sql);
const T0 = 1_790_000_000;

/** Paid spend on a project, through the acquisition ledger. */
function spend(id: string, projectId: string, cents: number) {
	exec(`insert into acquisition (id, kind, occurred_at, total_cents, project_id)
		values ('${id}', 'purchase', ${T0}, ${cents}, '${projectId}')`);
}

/** A night's cost sheet, which lands in the child's `show` block. */
function showCost(projectId: string, cents: number) {
	exec(`insert into production (id, project_id) values ('prod-${projectId}', '${projectId}')`);
	exec(`insert into production_expense (id, production_id, label, category, amount_cents)
		values ('x-${projectId}', 'prod-${projectId}', 'Engineer', 'sound', ${cents})`);
}

beforeEach(() => {
	for (const t of ['production_expense', 'production', 'acquisition', 'project']) {
		exec(`delete from ${t}`);
	}
	exec(`insert into project (id, name, budget_cents) values ('fest', 'Fall Fest', 100000)`);
	exec(`insert into project (id, name, kind, parent_project_id, starts_at) values
		('night-1', 'Night one', 'production', 'fest', ${T0}),
		('night-2', 'Night two', 'production', 'fest', ${T0 + 86_400})`);
	exec(`insert into project (id, name) values ('loose', 'Loose show')`);
});

describe("a parent project's burn", () => {
	it("sums each child's show block and spend with the parent's own", async () => {
		spend('a-fest', 'fest', 5000);
		spend('a-1', 'night-1', 2000);
		showCost('night-1', 15000);
		showCost('night-2', 9000);
		spend('a-loose', 'loose', 77_000);

		const burn = await getProjectBurn('fest');

		expect(burn.show.expensesCents).toBe(24_000);
		expect(burn.cash.acquisitionCents).toBe(7000);
		expect(burn.cash.totalCents).toBe(31_000);
		expect(burn.remainingCents).toBe(100_000 - 31_000);
		expect(burn.parts.map((p) => [p.projectId, p.cashCents])).toEqual([
			['fest', 5000],
			['night-1', 17_000],
			['night-2', 9000]
		]);
	});

	it("leaves a child's own burn as its own", async () => {
		spend('a-fest', 'fest', 5000);
		showCost('night-1', 15000);

		const burn = await getProjectBurn('night-1');

		expect(burn.cash.totalCents).toBe(15_000);
		expect(burn.parts).toEqual([]);
	});

	it('drops a child from the sum when it is detached', async () => {
		showCost('night-1', 15000);
		showCost('night-2', 9000);

		await updateProject('night-2', { parentProjectId: null });

		const burn = await getProjectBurn('fest');
		expect(burn.cash.totalCents).toBe(15_000);
		expect(burn.parts.map((p) => p.projectId)).toEqual(['fest', 'night-1']);
	});
});

describe('one level deep', () => {
	it('refuses a project as its own parent', async () => {
		await expect(updateProject('loose', { parentProjectId: 'loose' })).rejects.toThrow(
			ProjectParentError
		);
	});

	it('refuses a parent that is itself a child', async () => {
		await expect(updateProject('loose', { parentProjectId: 'night-1' })).rejects.toThrow(
			ProjectParentError
		);
		await expect(createProject({ name: 'Late set', parentProjectId: 'night-1' })).rejects.toThrow(
			ProjectParentError
		);
	});

	it('refuses to make a parent into a child', async () => {
		await expect(updateProject('fest', { parentProjectId: 'loose' })).rejects.toThrow(
			ProjectParentError
		);
	});

	it('attaches a project to a parent with no parent', async () => {
		await updateProject('loose', { parentProjectId: 'fest' });

		const family = await getProjectFamily('fest');
		expect(family.children.map((c) => c.id)).toEqual(['loose', 'night-1', 'night-2']);
		expect(family.parentOptions).toEqual([]);
	});

	it('offers only top-level projects other than itself as parents', async () => {
		const family = await getProjectFamily('night-1');

		expect(family.parent?.id).toBe('fest');
		expect(family.parentOptions.map((p) => p.id).sort()).toEqual(['fest', 'loose']);
	});
});
