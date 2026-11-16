import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Funding page's list (#2622), against a real SQLite: the stage each status
 * lands in, the order by what needs doing next, and which closed rows still show.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listFunding } = await import('./funding-service');

const TODAY = '2026-09-23';
/** Noon UTC on a day, as seconds: the same club day whichever zone runs the spec. */
const at = (day: string) => Date.parse(`${day}T19:00:00Z`) / 1000;

beforeEach(() => {
	for (const t of ['work_order', 'grant_application', 'sponsorship', 'project', 'organization']) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`insert into organization (id, name) values
		('oac', 'Arts Commission'), ('shop', 'Guitar Shop')`);
});

function grant(id: string, status: string, cols: Record<string, string | number> = {}) {
	sqlite.exec(`insert into project (id, name, kind) values ('p-${id}', '${id}', 'grant')`);
	const all = { id, organization_id: 'oac', title: id, status, project_id: `p-${id}`, ...cols };
	const values = Object.values(all).map((v) => (typeof v === 'number' ? v : `'${v}'`));
	sqlite.exec(
		`insert into grant_application (${Object.keys(all).join(', ')}) values (${values.join(', ')})`
	);
}

function ship(id: string, status: string) {
	sqlite.exec(`insert into project (id, name, kind) values ('p-${id}', '${id}', 'sponsorship')`);
	sqlite.exec(
		`insert into sponsorship (id, organization_id, title, status, project_id)
		 values ('${id}', 'shop', '${id}', '${status}', 'p-${id}')`
	);
}

const task = (id: string, projectId: string, due: string | null, resolved = false) =>
	sqlite.exec(
		`insert into work_order (id, project_id, title, due_at, resolved_at)
		 values ('${id}', '${projectId}', '${id}', ${due ? at(due) : 'null'}, ${resolved ? 1 : 'null'})`
	);

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const both = { today: TODAY, grants: true, sponsors: true };

describe('listFunding', () => {
	it('groups by stage: prospects, then pending applications, then what is running', async () => {
		grant('won', 'awarded');
		grant('sent', 'applied');
		ship('pitch', 'prospect');
		ship('running', 'active');
		const rows = await listFunding(both);
		expect(rows.map((r) => [r.id, r.stage])).toEqual([
			['pitch', 'prospect'],
			['sent', 'applied'],
			['won', 'active'],
			['running', 'active']
		]);
	});

	it('orders a stage by the sooner of its next task and its deadline, undated last', async () => {
		grant('late-task', 'prospect');
		grant('early-deadline', 'prospect', { apply_by: '2026-10-01' });
		grant('undated', 'prospect');
		task('t1', 'p-late-task', '2026-10-20');
		task('t2', 'p-late-task', '2026-09-30', true);
		const rows = await listFunding(both);
		expect(ids(rows)).toEqual(['early-deadline', 'late-task', 'undated']);
		expect(rows[1].nextTask?.id).toBe('t1');
		expect(rows[1].nextOn).toBe('2026-10-20');
	});

	it('keeps a closed one with open work, and the rest behind "Show closed"', async () => {
		grant('final-report', 'closed');
		task('report', 'p-final-report', '2026-11-01');
		grant('done', 'closed');
		ship('over', 'ended');
		expect(ids(await listFunding(both))).toEqual(['final-report']);
		expect(ids(await listFunding({ ...both, includeClosed: true })).sort()).toEqual([
			'done',
			'final-report',
			'over'
		]);
	});

	it('reads only the modules asked for', async () => {
		grant('g', 'prospect');
		ship('s', 'prospect');
		expect(ids(await listFunding({ ...both, sponsors: false }))).toEqual(['g']);
		expect(ids(await listFunding({ ...both, grants: false }))).toEqual(['s']);
	});

	it('shows what was awarded, else what was asked', async () => {
		grant('asked', 'applied', { amount_requested_cents: 5000 });
		grant('given', 'awarded', { amount_requested_cents: 5000, amount_awarded_cents: 4000 });
		const by = Object.fromEntries(
			(await listFunding(both)).map((r) => [r.id, [r.amountCents, r.asked]])
		);
		expect(by).toEqual({ asked: [5000, true], given: [4000, false] });
	});
});
