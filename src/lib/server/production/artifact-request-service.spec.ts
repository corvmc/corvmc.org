import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Asking, and deriving whether it came. Against a real SQLite because the
 * uniqueness rule — one live ask per artifact per act — is a constraint, and a
 * mocked `db` has none.
 */

const { sqlite, testDb } = vi.hoisted(() => {
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { readFileSync, globSync } = require('node:fs') as typeof import('node:fs');
	const Database = require('better-sqlite3') as typeof import('better-sqlite3');
	const { drizzle } =
		require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
	/* eslint-enable @typescript-eslint/no-require-imports */

	/**
	 * The `CREATE TABLE` from whichever migration last created it, plus any later
	 * `ALTER TABLE … ADD`. Replaying the ALTERs is what keeps this tracking the
	 * schema rather than a fossil — see `inventory/reports.spec.ts`, which
	 * established the pattern and explains the quiet failure it avoids.
	 */
	function ddlFor(table: string): string[] {
		const marker = `CREATE TABLE \`${table}\``;
		const files = globSync('migrations/*/migration.sql').sort();
		const createdIn = files.filter((f: string) => readFileSync(f, 'utf8').includes(marker)).pop();
		if (!createdIn) throw new Error(`no migration creates ${table}`);

		const statementsIn = (file: string) =>
			readFileSync(file, 'utf8')
				.split('--> statement-breakpoint')
				.map((c: string) => c.trim().replace(/;$/, ''))
				.filter(Boolean);

		const create = statementsIn(createdIn).find((c: string) => c.startsWith(marker));
		if (!create) throw new Error(`no CREATE TABLE statement for ${table} in ${createdIn}`);

		const alterMarker = `ALTER TABLE \`${table}\` ADD`;
		const alters = files
			.slice(files.indexOf(createdIn) + 1)
			.flatMap(statementsIn)
			.filter((c: string) => c.startsWith(alterMarker));

		// Indexes too, which `inventory/reports.spec.ts` does not need and this
		// does: `requestArtifact` upserts on a unique index, and ON CONFLICT
		// against an index the harness never created fails at runtime rather
		// than looking like a missing table.
		const indexes = files
			.slice(files.indexOf(createdIn))
			.flatMap(statementsIn)
			.filter((c: string) => /^CREATE (UNIQUE )?INDEX/.test(c) && c.includes(`ON \`${table}\``))
			// A rebuild re-creates its indexes, so the same name appears twice.
			.map((c: string) => c.replace(/^CREATE (UNIQUE )?INDEX/, 'CREATE $1INDEX IF NOT EXISTS'));

		return [create, ...alters, ...indexes];
	}

	const sqlite = new Database(':memory:');
	// The DDL carries foreign keys into `user`, which this spec has no reason to
	// create — it is testing aggregation, not referential integrity. better-sqlite3
	// turns enforcement on by default, so turn it back off rather than seeding a
	// user table that no assertion reads.
	sqlite.pragma('foreign_keys = OFF');

	// Two tables the service touches are absent on purpose. `event_listing` was
	// created as `event` and renamed, and `event_band` was rebuilt, so neither
	// has a CREATE under its current name for `ddlFor` to find. Neither is
	// queried here: the FK is production's, and `foreign_keys` is off above.
	for (const t of ['artifact_request', 'directory_entry']) {
		for (const stmt of ddlFor(t)) sqlite.exec(stmt);
	}

	// `event_band` by hand, and only the columns `requestableActs` reads: it was
	// rebuilt, so `ddlFor` finds no CREATE under its current name (#847).
	sqlite.exec(
		'create table event_band (id text primary key, event_id text, name text, billing_order integer, directory_entry_id text)'
	);

	// `drizzle({ client })`, not `drizzle(client)`. drizzle 1.0 dropped the
	// positional overload: a raw Database passed positionally is read as a
	// *config* object, finds no client in it, and quietly opens a second, empty
	// database — so every query answers "no such table" against tables that
	// demonstrably exist on `sqlite`.
	return { sqlite, testDb: drizzle({ client: sqlite }) };
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const riderSummaries = vi.fn(async () => [] as { name: string; empty: boolean }[]);
vi.mock('$lib/server/band/rider-service', () => ({
	getEventRiderSummaries: () => riderSummaries()
}));

const { cancelArtifactRequest, listRequests, outstandingCount, requestArtifact, requestableActs } =
	await import('./artifact-request-service');

const EVENT = 'evt-1';
const ENTRY = 'entry-1';

beforeEach(() => {
	for (const t of ['artifact_request', 'directory_entry', 'event_band']) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(
		`insert into directory_entry (id, name, visibility) values ('${ENTRY}', 'The Wrens', 'public')`
	);
	riderSummaries.mockResolvedValue([]);
});

describe('asking', () => {
	it('records the ask and its deadline', async () => {
		const due = new Date('2026-10-01T00:00:00Z');
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider', dueAt: due });

		const [req] = await listRequests(EVENT);
		expect(req).toMatchObject({ artifact: 'tech_rider', actName: 'The Wrens', fulfilled: false });
		expect(req.dueAt?.toISOString()).toBe(due.toISOString());
	});

	it('treats asking again as a reminder, not a second request', async () => {
		// Two rows would double what the show appears to be waiting on.
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });
		await requestArtifact({
			eventId: EVENT,
			entryId: ENTRY,
			artifact: 'tech_rider',
			dueAt: new Date('2026-10-05T00:00:00Z')
		});

		const reqs = await listRequests(EVENT);
		expect(reqs).toHaveLength(1);
		expect(reqs[0].dueAt).not.toBeNull();
	});

	it('drops a withdrawn ask out of what is outstanding', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		const [req] = await listRequests(EVENT);
		await cancelArtifactRequest(req.id);
		expect(await listRequests(EVENT)).toHaveLength(0);
	});
});

describe('deriving whether it came', () => {
	it('counts a rider that arrived, asked for or not', async () => {
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: false }]);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });

		const [req] = await listRequests(EVENT);
		expect(req.fulfilled).toBe(true);
		expect(await outstandingCount(EVENT)).toBe(0);
	});

	it('leaves an empty rider outstanding', async () => {
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: true }]);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });
		expect(await outstandingCount(EVENT)).toBe(1);
	});

	it('reads a press kit off the listing having a bio', async () => {
		sqlite.exec(`update directory_entry set bio = 'Four of them, from Corvallis.'`);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		expect((await listRequests(EVENT))[0].fulfilled).toBe(true);
	});

	it('treats whitespace as no bio at all', async () => {
		sqlite.exec(`update directory_entry set bio = '   '`);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		expect((await listRequests(EVENT))[0].fulfilled).toBe(false);
	});
});

describe('overdue', () => {
	const past = new Date('2026-01-01T00:00:00Z');
	const now = new Date('2026-02-01T00:00:00Z');

	it('flags an unfulfilled ask past its date', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk', dueAt: past });
		expect((await listRequests(EVENT, now))[0].overdue).toBe(true);
	});

	it('does not flag one that arrived late', async () => {
		// The deadline mattered before it came; afterwards it is just done.
		sqlite.exec(`update directory_entry set bio = 'Here at last.'`);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk', dueAt: past });
		expect((await listRequests(EVENT, now))[0].overdue).toBe(false);
	});

	it('does not flag an ask with no deadline', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		expect((await listRequests(EVENT, now))[0].overdue).toBe(false);
	});
});

describe('who can be asked', () => {
	const credit = (id: string, name: string, order: number, entry: string | null) =>
		sqlite.exec(
			`insert into event_band (id, event_id, name, billing_order, directory_entry_id) values ('${id}', '${EVENT}', '${name}', ${order}, ${entry ? `'${entry}'` : 'null'})`
		);

	it('offers the bill in billing order', async () => {
		credit('eb-2', 'Second', 2, ENTRY);
		sqlite.exec(
			`insert into directory_entry (id, name, visibility) values ('entry-2', 'Openers', 'public')`
		);
		credit('eb-1', 'First', 1, 'entry-2');

		expect(await requestableActs(EVENT)).toEqual([
			{ entryId: 'entry-2', name: 'First' },
			{ entryId: ENTRY, name: 'Second' }
		]);
	});

	it('leaves out a credit with no listing, which has nowhere to receive an ask', async () => {
		credit('eb-1', 'Bare name', 1, null);
		expect(await requestableActs(EVENT)).toEqual([]);
	});
});
