import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import {
	appliedMigrationNames,
	classifyMigration,
	isProductionBranch,
	pendingMigrations,
	planMigrate
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

	it('throws when D1 reports failure, so the build stops rather than guessing', async () => {
		const fetch = vi.fn(async () =>
			Response.json({ success: false, errors: [{ message: 'no such table' }] }, { status: 400 })
		);
		await expect(appliedMigrationNames(creds, fetch)).rejects.toThrow(/no such table/);
	});
});
