import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import {
	appliedMigrationNames,
	classifyMigration,
	isProductionBranch,
	pendingMigrations,
	planMigrate,
	rebuiltTables,
	tableColumns
} from './ci-migrate.mjs';

// `build` no longer runs this script — it is `vite build`, and the migrate is invoked
// through `pnpm ci:migrate` from the build command configured in the Cloudflare dashboard.
// The assertion that pinned `ci-migrate.mjs` into `build` lived here and is gone with it.
// Worth knowing what that guard was for: the dashboard field is invisible to code review and
// is reset when the GitHub connection is recreated, which is what happened when the repo moved
// to `corvmc/corvmc.org` — the `pnpm ci:migrate &&` half vanished, #267's `band` -> `group`
// rename published without its migration, and every route touching a band 500ed with
// `no such table: group`. Whatever runs the migrate now, nothing in this repo checks that it does.

// Cloudflare Workers Builds is the only thing that deploys this app, and with the
// merge queue enabled it builds — and publishes to production — the queue's
// `gh-readonly-queue/main/*` branch, not `main`. It never rebuilds the identical SHA
// once the queue merges it, so a branch check that only accepts `main` skips the
// migrate for every queued PR while shipping its code. That is how #241's
// the roster table's `alias` column reached production as a 500 rather than a column.
describe('isProductionBranch', () => {
	it('accepts the merge queue branch that actually deployed #241', () => {
		expect(
			isProductionBranch('gh-readonly-queue/main/pr-241-5979019840c1d301e3b96d14a4363d11771a2efb')
		).toBe(true);
	});

	it('accepts a direct push to main', () => {
		expect(isProductionBranch('main')).toBe(true);
	});

	it('skips a feature branch', () => {
		expect(isProductionBranch('claude/band-member-alias-migration-c35c74')).toBe(false);
	});

	it('skips an unknown branch, which is what an unset env var looks like', () => {
		expect(isProductionBranch('')).toBe(false);
	});

	// A queue on some other base is not production, however it is spelled.
	it('skips a merge queue targeting another base branch', () => {
		expect(isProductionBranch('gh-readonly-queue/some-other-base/pr-1-abc')).toBe(false);
	});

	it('skips a branch that merely starts with the production branch name', () => {
		expect(isProductionBranch('maintenance')).toBe(false);
		expect(isProductionBranch('gh-readonly-queue/maintenance/pr-1-abc')).toBe(false);
	});
});

const committed = (name: string) =>
	readFileSync(new URL(`../migrations/${name}/migration.sql`, import.meta.url), 'utf8');

// Contract statements take something away. Run before publish they break the live Worker,
// which still selects what they removed (#1350); run after publish the new Worker has
// already stopped reading it.
describe('classifyMigration', () => {
	it('calls a lone DROP COLUMN contract — the shape #1355 ships', () => {
		expect(classifyMigration('ALTER TABLE `account` DROP COLUMN `issuer`;')).toBe('contract');
	});

	it('calls dropped tables and their indexes contract', () => {
		expect(classifyMigration(committed('20260817220046_kind_ultimatum'))).toBe('contract');
		expect(classifyMigration(committed('20260828042246_rainy_arclight'))).toBe('contract');
	});

	it('calls a table rebuild expand, although it contains DROP TABLE', () => {
		expect(classifyMigration(committed('20260526000329_clumsy_post'))).toBe('expand');
	});

	it('calls additions, renames and index changes expand', () => {
		expect(classifyMigration('ALTER TABLE `x` ADD `y` text;')).toBe('expand');
		expect(classifyMigration(committed('20260826213219_band_member_to_group_member'))).toBe(
			'expand'
		);
		expect(
			classifyMigration(
				'DROP INDEX IF EXISTS `idx_a`;--> statement-breakpoint\nCREATE INDEX `idx_a` ON `x` (`y`);'
			)
		).toBe('expand');
	});

	it('ignores a scratch table the same migration creates and drops', () => {
		expect(
			classifyMigration(
				'CREATE TABLE `_bk_x` AS SELECT * FROM `x`;--> statement-breakpoint\nDROP TABLE `_bk_x`;'
			)
		).toBe('expand');
	});

	it('calls one migration that both adds and drops mixed', () => {
		expect(classifyMigration(committed('20260731014007_vengeful_sunspot'))).toBe('mixed');
		// Copies band_page_config into new columns, then drops it: neither side of the publish is safe.
		expect(classifyMigration(committed('20260828191226_sloppy_micromax'))).toBe('mixed');
	});
});

// A rebuild's DROP TABLE is not a removal, but the rebuild itself can be one: SQLite cannot
// `DROP COLUMN` a column with a table-level FOREIGN KEY, so drizzle drops it by rebuilding (#1747).
// The file never names the old columns, so the classifier is handed them.
describe('classifyMigration on a table rebuild', () => {
	const B = '--> statement-breakpoint\n';
	const list = (cols: string[]) => cols.map((c) => `\`${c}\``).join(', ');
	const rebuild = (cols: string[]) =>
		[
			'PRAGMA foreign_keys=OFF;',
			`CREATE TABLE \`__new_note\` (\n${cols.map((c) => `\t\`${c}\` text`).join(',\n')},\n\tCONSTRAINT \`fk_note\` FOREIGN KEY (\`id\`) REFERENCES \`x\`(\`id\`)\n);`,
			`INSERT INTO \`__new_note\`(${list(cols)}) SELECT ${list(cols)} FROM \`note\`;`,
			'DROP TABLE `note`;',
			'ALTER TABLE `__new_note` RENAME TO `note`;',
			'CREATE INDEX `idx_note_body` ON `note` (`body`);',
			'PRAGMA foreign_keys=ON;'
		].join(B);
	const columns = new Map([['note', ['id', 'body', 'group_id']]]);

	it('calls a rebuild that only loses a column contract', () => {
		expect(classifyMigration(rebuild(['id', 'body']), columns)).toBe('contract');
	});

	it('calls a rebuild that only gains a column expand', () => {
		expect(classifyMigration(rebuild(['id', 'body', 'group_id', 'title']), columns)).toBe('expand');
	});

	it('calls a rebuild that loses one column and gains another mixed', () => {
		expect(classifyMigration(rebuild(['id', 'body', 'title']), columns)).toBe('mixed');
	});

	it('calls a rebuild that keeps its columns expand, as before', () => {
		expect(classifyMigration(rebuild(['id', 'body', 'group_id']), columns)).toBe('expand');
	});

	// d1-safe-rebuild wraps the drop in detach/reattach rebuilds of every child and restores
	// their triggers. None of that changes a column, so none of it may read as expand.
	it("still calls the drop contract inside d1-safe-rebuild's detach, reattach and trigger restore", () => {
		const child = (tmp: string) => [
			`CREATE TABLE \`${tmp}_child\` (\n\t\`id\` text,\n\t\`note_id\` text\n);`,
			`INSERT INTO \`${tmp}_child\`(\`id\`, \`note_id\`) SELECT \`id\`, \`note_id\` FROM \`child\`;`,
			'DROP TABLE `child`;',
			`ALTER TABLE \`${tmp}_child\` RENAME TO \`child\`;`,
			'CREATE UNIQUE INDEX `uq_child_note` ON `child` (`note_id`);'
		];
		const sql = [
			'-- d1-safe-rebuild: rewritten for Cloudflare D1.\nPRAGMA defer_foreign_keys=ON;',
			...child('__detach'),
			rebuild(['id', 'body']),
			...child('__reattach'),
			'PRAGMA defer_foreign_keys=OFF;',
			"-- restore trigger `child_note_required`\nCREATE TRIGGER `child_note_required`\nBEFORE INSERT ON `child`\nWHEN NEW.note_id IS NULL\nBEGIN\n\tSELECT RAISE(ABORT, 'child.note_id is required');\nEND;"
		].join(B);
		expect(classifyMigration(sql, columns)).toBe('contract');
	});

	it('reads a new trigger on a table nothing rebuilds as expand', () => {
		expect(
			classifyMigration(
				"CREATE TRIGGER `t` BEFORE INSERT ON `note` BEGIN SELECT RAISE(ABORT, 'no'); END;"
			)
		).toBe('expand');
	});

	it('names only the tables drizzle rebuilt, not the detached children', () => {
		expect(rebuiltTables(rebuild(['id']))).toEqual(['note']);
	});
});
describe('pendingMigrations', () => {
	it('is every local folder whose name the database has not recorded, in order', () => {
		expect(pendingMigrations(['b', 'a', 'c'], ['a'])).toEqual(['b', 'c']);
	});
});

describe('planMigrate', () => {
	const expand = { name: '1_add', kind: 'expand' } as const;
	const contract = { name: '2_drop', kind: 'contract' } as const;

	it('does nothing when nothing is pending', () => {
		expect(planMigrate([])).toEqual({ when: 'none' });
	});

	it('migrates before publish when nothing pending is a contract', () => {
		expect(planMigrate([expand])).toEqual({ when: 'before' });
	});

	it('defers a contract-only batch until after publish', () => {
		expect(planMigrate([contract])).toEqual({ when: 'after' });
	});

	// drizzle-kit migrate applies every pending migration at once, so a batch cannot be
	// split between the two phases.
	it('refuses a batch that mixes expand and contract, naming both', () => {
		const plan = planMigrate([expand, contract]);
		expect(plan.when).toBe('refuse');
		expect(plan.when === 'refuse' && plan.reason).toMatch(/1_add[\s\S]*2_drop/);
	});

	it('refuses a single mixed migration, naming it', () => {
		const plan = planMigrate([{ name: '3_both', kind: 'mixed' }]);
		expect(plan.when).toBe('refuse');
		expect(plan.when === 'refuse' && plan.reason).toMatch(/3_both/);
	});
});

describe('appliedMigrationNames', () => {
	const creds = { accountId: 'acc', databaseId: 'db', token: 'tok' };

	it('reads the names drizzle recorded, over the D1 HTTP API', async () => {
		const fetch = vi.fn(async () =>
			Response.json({ success: true, result: [{ results: [{ name: 'a' }, { name: null }] }] })
		);
		await expect(appliedMigrationNames(creds, fetch)).resolves.toEqual(['a']);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db/query');
		expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
		expect(JSON.parse(String(init.body)).sql).toMatch(/SELECT name FROM __drizzle_migrations/);
	});

	it("reads a table's columns from production, and none for a table it lacks", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				success: true,
				result: [{ results: [{ name: 'id' }, { name: 'body' }] }]
			})
		);
		await expect(tableColumns(creds, 'note', fetch)).resolves.toEqual(['id', 'body']);
		const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(String(init.body)).sql).toBe('PRAGMA table_info(`note`)');
		const empty = vi.fn(async () => Response.json({ success: true, result: [{ results: [] }] }));
		await expect(tableColumns(creds, 'note', empty)).resolves.toBeUndefined();
	});
	it('throws when D1 reports failure, so the build stops rather than guessing', async () => {
		const fetch = vi.fn(async () =>
			Response.json({ success: false, errors: [{ message: 'no such table' }] }, { status: 400 })
		);
		await expect(appliedMigrationNames(creds, fetch)).rejects.toThrow(/no such table/);
	});
});
