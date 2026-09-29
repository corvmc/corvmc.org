import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A show as a project, against a real SQLite replayed from the migrations:
 * who its committees let act (the allowed and denied matrix per committee),
 * shifts that follow the show's clock, and the show's money in project burn.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));
vi.mock('$lib/server/volunteer/hour-value', () => ({ getHourValueCents: async () => 3000 }));
vi.mock('./run-of-show-service', () => ({ recomputeSetTimes: async () => undefined }));
vi.mock('$lib/server/finance/production-expense-entries', () => ({
	postProductionExpenses: async () => undefined
}));

const { projectCommitteeGrantsFor } = await import('$lib/server/capability/capability-grants');
const { updateProductionDetails, transitionProduction } = await import('./production-service');
const { getProjectBurn } = await import('$lib/server/project/project-service');

const SHOW = 'proj-show';
const OTHER = 'proj-other';
const T0 = 1_790_000_000; // seconds

function exec(sql: string) {
	sqlite.exec(sql);
}

function committee(id: string, caps: string[], opts: { deleted?: boolean } = {}) {
	exec(
		`insert into "group" (id, name, slug, kind, deleted_at) values ('${id}', '${id}', '${id}', 'committee', ${opts.deleted ? 1 : 'null'})`
	);
	for (const c of caps) {
		exec(`insert into group_capability (group_id, capability) values ('${id}', '${c}')`);
	}
}

function seat(groupId: string, userId: string, status = 'active') {
	exec(
		`insert into group_member (id, group_id, user_id, role, status) values ('${groupId}-${userId}', '${groupId}', '${userId}', 'member', '${status}')`
	);
}

beforeEach(() => {
	for (const t of [
		'financial_entry',
		'production_expense',
		'work_order',
		'duty_list',
		'volunteer_role',
		'event_listing',
		'production',
		'project_committee',
		'project',
		'group_capability',
		'group_member',
		'"group"',
		'user'
	]) {
		exec(`delete from ${t}`);
	}
	for (const u of ['u-book', 'u-prod', 'u-fac', 'u-lapsed', 'u-gone']) {
		exec(
			`insert into user (id, name, email, email_verified) values ('${u}', '${u}', '${u}@x.test', 0)`
		);
	}
	committee('g-book', ['production.book', 'event.publish', 'project.manage']);
	committee('g-prod', ['production.run', 'volunteer.manageShifts']);
	committee('g-fac', ['project.manage']);
	committee('g-gone', ['production.run'], { deleted: true });
	seat('g-book', 'u-book');
	seat('g-prod', 'u-prod');
	seat('g-fac', 'u-fac');
	seat('g-prod', 'u-lapsed', 'inactive');
	seat('g-gone', 'u-gone');

	exec(`insert into project (id, name, kind) values ('${SHOW}', 'Friday', 'production')`);
	exec(`insert into project (id, name) values ('${OTHER}', 'Repaint')`);
	exec(`insert into project_committee (project_id, group_id, role) values
		('${SHOW}', 'g-book', 'booking'), ('${SHOW}', 'g-prod', 'production'),
		('${SHOW}', 'g-gone', 'production'), ('${OTHER}', 'g-fac', 'owner')`);
});

describe('what each committee may do on a show', () => {
	async function holds(userId: string, projectId: string, cap: string) {
		const seats = await projectCommitteeGrantsFor(userId, projectId);
		return seats.some((s) => s.capabilities.includes(cap));
	}

	const matrix: [string, string, boolean, boolean][] = [
		// user, why, may book, may run
		['u-book', 'Booking', true, false],
		['u-prod', 'Production', false, true],
		['u-fac', 'a committee on another project', false, false],
		['u-lapsed', 'an inactive Production seat', false, false],
		['u-gone', 'a seat on a deleted committee', false, false]
	];

	it.each(matrix)('%s (%s): book %s, run %s', async (userId, _why, book, run) => {
		expect(await holds(userId, SHOW, 'production.book')).toBe(book);
		expect(await holds(userId, SHOW, 'production.run')).toBe(run);
	});

	it('reaches only projects the committee takes part in', async () => {
		expect(await holds('u-book', OTHER, 'project.manage')).toBe(false);
		expect(await holds('u-fac', OTHER, 'project.manage')).toBe(true);
		expect(await holds('u-fac', SHOW, 'project.manage')).toBe(false);
	});

	it('names the seats that passed, so each committee page can refresh', async () => {
		expect(await projectCommitteeGrantsFor('u-book', SHOW)).toEqual([
			expect.objectContaining({ groupId: 'g-book', slug: 'g-book' })
		]);
	});

	it('drops a grant that has left the allowlist', async () => {
		exec(`insert into group_capability (group_id, capability) values ('g-book', 'user.purge')`);
		const [seatRow] = await projectCommitteeGrantsFor('u-book', SHOW);
		expect(seatRow.capabilities).not.toContain('user.purge');
	});
});

describe('shifts follow the show clock', () => {
	function show() {
		exec(
			`insert into production (id, project_id, load_in_at, soundcheck_at) values ('prod-1', '${SHOW}', ${T0}, ${T0 + 3600})`
		);
		exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, production_id, project_id)
			values ('evt-1', 'Friday', ${T0 + 7200}, ${T0 + 14400}, 'u-book', 'cmc', 'show', 'prod-1', '${SHOW}')`);
		exec(`insert into volunteer_role (id, name) values ('role-1', 'Sound')`);
		exec(`insert into duty_list (id, name, anchor, subject) values
			('dl-in', 'Load-in crew', 'load_in', 'event'), ('dl-doors', 'Door', 'doors', 'event')`);
		exec(`insert into work_order (id, volunteer_role_id, event_id, starts_at, ends_at, duty_list_id, cancelled_at) values
			('wo-in', 'role-1', 'evt-1', ${T0 - 1800}, ${T0 + 1800}, 'dl-in', null),
			('wo-in-cancelled', 'role-1', 'evt-1', ${T0 - 1800}, ${T0 + 1800}, 'dl-in', ${T0}),
			('wo-door', 'role-1', 'evt-1', ${T0 + 7200}, ${T0 + 9000}, 'dl-doors', null)`);
	}
	const at = (id: string) =>
		sqlite.prepare(`select starts_at s, ends_at e from work_order where id = ?`).get(id) as {
			s: number;
			e: number;
		};

	it('moves a live load-in shift by exactly as much as load-in moved', async () => {
		show();
		await updateProductionDetails('prod-1', { loadInAt: new Date((T0 + 1800) * 1000) });
		expect(at('wo-in')).toEqual({ s: T0, e: T0 + 3600 });
	});

	it('leaves cancelled work, and work on another anchor, where it was', async () => {
		show();
		await updateProductionDetails('prod-1', { loadInAt: new Date((T0 + 1800) * 1000) });
		expect(at('wo-in-cancelled')).toEqual({ s: T0 - 1800, e: T0 + 1800 });
		expect(at('wo-door')).toEqual({ s: T0 + 7200, e: T0 + 9000 });
	});

	it('does nothing when the time is cleared, since there is nothing to measure from', async () => {
		show();
		await updateProductionDetails('prod-1', { loadInAt: null });
		expect(at('wo-in')).toEqual({ s: T0 - 1800, e: T0 + 1800 });
	});
});

describe("a show's project follows the show", () => {
	it('is done once the show completes', async () => {
		exec(
			`insert into production (id, project_id, status) values ('prod-1', '${SHOW}', 'confirmed')`
		);
		await transitionProduction('prod-1', 'completed');
		expect(sqlite.prepare(`select status from project where id = ?`).get(SHOW)).toEqual({
			status: 'done'
		});
	});

	it('is untouched when the transition was refused', async () => {
		exec(`insert into production (id, project_id, status) values ('prod-1', '${SHOW}', 'draft')`);
		await expect(transitionProduction('prod-1', 'completed')).rejects.toThrow();
		expect(sqlite.prepare(`select status from project where id = ?`).get(SHOW)).toEqual({
			status: 'open'
		});
	});
});

describe("a show's money in its project's burn", () => {
	it('counts tickets and payouts from the ledger and the cost sheet as written', async () => {
		exec(`insert into production (id, project_id) values ('prod-1', '${SHOW}')`);
		exec(`insert into production_expense (id, production_id, label, category, amount_cents)
			values ('x-1', 'prod-1', 'Engineer', 'sound', 15000)`);
		const row = (
			id: string,
			amount: number,
			kind: string,
			category: string,
			subject: string,
			project: string | null = SHOW
		) =>
			exec(`insert into financial_entry (id, amount_cents, kind, category, occurred_at, settlement, subject_type, subject_id, project_id, description)
				values ('${id}', ${amount}, '${kind}', '${category}', ${T0}, 'stripe', '${subject}', 's', ${project ? `'${project}'` : 'null'}, 'x')`);
		row('t-cut', 3000, 'earned', 'ticket_sales', 'ticket');
		row('t-pool', 7000, 'pass_through', 'act_payout', 'ticket');
		row('p-pool', -7000, 'pass_through', 'act_payout', 'production');
		row('p-top', -2000, 'spent', 'act_guarantee', 'production');
		row('elsewhere', 99_999, 'earned', 'ticket_sales', 'ticket', null);

		const burn = await getProjectBurn(SHOW);

		expect(burn.show).toEqual({
			ticketRevenueCents: 3000,
			actsPoolInCents: 7000,
			actPayoutsCents: 9000,
			guaranteeTopUpCents: 2000,
			expensesCents: 15000
		});
		// Pass-through is the acts' money, never the collective's spend.
		expect(burn.cash.showCents).toBe(17000);
		expect(burn.cash.totalCents).toBe(17000);
	});
});
