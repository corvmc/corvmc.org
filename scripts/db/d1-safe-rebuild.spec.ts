import { describe, it, expect } from 'vitest';
import {
	rewriteMigration,
	findCreatedTables,
	findRebuiltTables,
	findUnsafeDrops,
	collapseCommentOnlyChunks
} from './d1-safe-rebuild.mjs';
import { childGraph, descendantsDeepestFirst, readSnapshot } from './d1-ddl.mjs';

/** parent <- child <- grandchild, plus a second child on the parent. */
const snapshot = {
	ddl: [
		{ entityType: 'tables', name: 'parent' },
		{ entityType: 'tables', name: 'child' },
		{ entityType: 'tables', name: 'grandchild' },
		{ entityType: 'tables', name: 'sibling' },
		{
			entityType: 'columns',
			table: 'parent',
			name: 'id',
			type: 'text',
			notNull: true,
			default: null
		},
		{ entityType: 'pks', table: 'parent', name: 'parent_pk', columns: ['id'] },
		{
			entityType: 'columns',
			table: 'child',
			name: 'id',
			type: 'text',
			notNull: true,
			default: null
		},
		{
			entityType: 'columns',
			table: 'child',
			name: 'parent_id',
			type: 'text',
			notNull: false,
			default: null
		},
		{ entityType: 'pks', table: 'child', name: 'child_pk', columns: ['id'] },
		{
			entityType: 'fks',
			table: 'child',
			name: 'fk_child',
			columns: ['parent_id'],
			tableTo: 'parent',
			columnsTo: ['id'],
			onDelete: 'CASCADE',
			onUpdate: 'NO ACTION'
		},
		{
			entityType: 'columns',
			table: 'grandchild',
			name: 'id',
			type: 'text',
			notNull: true,
			default: null
		},
		{
			entityType: 'columns',
			table: 'grandchild',
			name: 'child_id',
			type: 'text',
			notNull: true,
			default: null
		},
		{ entityType: 'pks', table: 'grandchild', name: 'grandchild_pk', columns: ['id'] },
		{
			entityType: 'fks',
			table: 'grandchild',
			name: 'fk_gc',
			columns: ['child_id'],
			tableTo: 'child',
			columnsTo: ['id'],
			onDelete: 'CASCADE',
			onUpdate: 'NO ACTION'
		},
		{
			entityType: 'columns',
			table: 'sibling',
			name: 'id',
			type: 'text',
			notNull: true,
			default: null
		},
		{ entityType: 'pks', table: 'sibling', name: 'sibling_pk', columns: ['id'] }
	]
};

const BREAK = '\n--> statement-breakpoint\n';
const generated = [
	'PRAGMA foreign_keys=OFF;',
	'CREATE TABLE `__new_parent` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`label` text\n);',
	'INSERT INTO `__new_parent`(`id`) SELECT `id` FROM `parent`;',
	'DROP TABLE `parent`;',
	'ALTER TABLE `__new_parent` RENAME TO `parent`;',
	'PRAGMA foreign_keys=ON;'
].join(BREAK);

describe('findRebuiltTables', () => {
	it('finds a table rebuilt via the __new_ + DROP pattern', () => {
		expect(findRebuiltTables(generated)).toEqual(['parent']);
	});

	it('ignores a plain CREATE TABLE with no matching DROP', () => {
		expect(findRebuiltTables('CREATE TABLE `venue` (`id` text);')).toEqual([]);
	});
});

describe('findCreatedTables', () => {
	it('finds plainly created tables', () => {
		expect(findCreatedTables('CREATE TABLE `child` (\n\t`id` text\n);')).toEqual(['child']);
	});

	it('ignores rebuild and detach scratch tables', () => {
		const sql = [
			'CREATE TABLE `__new_parent` (`id` text);',
			'CREATE TABLE `__detach_child` (`id` text);',
			'CREATE TABLE `__reattach_child` (`id` text);'
		].join('\n');
		expect(findCreatedTables(sql)).toEqual([]);
	});
});

// Regression: a migration that both adds a new child table AND rebuilds its
// parent (e.g. relaxing a NOT NULL) used to emit a detach block for that child
// — copying rows out of a table that the same migration had not created yet.
// Applying it failed with "no such table". A table created here is empty, so
// the parent's DROP cascading into it destroys nothing worth saving.
describe('a child created by this same migration', () => {
	const addChildAndRebuildParent = [
		'CREATE TABLE `child` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`parent_id` text\n);',
		generated
	].join(BREAK);

	const out = rewriteMigration(addChildAndRebuildParent, snapshot) as string;

	it('is never detached', () => {
		expect(out).not.toContain('__detach_child');
	});

	it('still detaches children that already exist', () => {
		expect(out).toContain('__detach_grandchild');
	});

	it("keeps the new table's own CREATE", () => {
		expect(out).toContain('CREATE TABLE `child`');
	});
});

describe('descendant ordering', () => {
	it('returns descendants deepest-first so each drop cascades to nothing', () => {
		const order = descendantsDeepestFirst('parent', childGraph(readSnapshot(snapshot)));
		expect(order).toEqual(['grandchild', 'child']);
	});

	it('excludes tables that do not reference the rebuilt table', () => {
		const order = descendantsDeepestFirst('parent', childGraph(readSnapshot(snapshot)));
		expect(order).not.toContain('sibling');
	});
});

describe('findUnsafeDrops', () => {
	const kids = childGraph(readSnapshot(snapshot));
	const find = (sql: string) => findUnsafeDrops(sql, kids, findRebuiltTables(sql));

	it('flags a hand-written rebuild that uses its own temp-table name', () => {
		// The `__new_` detector misses this, but it destroys child rows identically.
		expect(
			find(
				'CREATE TABLE `parent_tmp` (`id` text);\nDROP TABLE `parent`;\n' +
					'ALTER TABLE `parent_tmp` RENAME TO `parent`;'
			)
		).toEqual(['parent']);
	});

	it('flags a bare drop of a table with children', () => {
		expect(find('DROP TABLE `parent`;')).toEqual(['parent']);
	});

	it('flags DROP TABLE IF EXISTS too', () => {
		expect(find('DROP TABLE IF EXISTS `parent`;')).toEqual(['parent']);
	});

	it('allows dropping a table that nothing references', () => {
		expect(find('DROP TABLE `sibling`;')).toEqual([]);
	});

	it('allows a drop that is explicitly marked intentional', () => {
		expect(find('-- d1-safe-rebuild: intentional drop `parent`\nDROP TABLE `parent`;')).toEqual([]);
	});

	it('does not flag the drops inside its own rewritten output', () => {
		const out = rewriteMigration(generated, snapshot) as string;
		expect(findUnsafeDrops(out, kids, findRebuiltTables(out))).toEqual([]);
	});

	it('ignores scratch tables created by the rewrite', () => {
		expect(find('DROP TABLE `__detach_child`;\nDROP TABLE `__reattach_child`;')).toEqual([]);
	});
});

describe('rewriteMigration', () => {
	const out = rewriteMigration(generated, snapshot) as string;

	it('detaches deepest-first and reattaches in the reverse order', () => {
		const seq = [...out.matchAll(/-- (detach|reattach) (\w+)/g)].map((m) => `${m[1]} ${m[2]}`);
		expect(seq).toEqual([
			'detach grandchild',
			'detach child',
			'reattach child',
			'reattach grandchild'
		]);
	});

	it('demotes the FK action while detached', () => {
		const detach = out.slice(out.indexOf('-- detach child'), out.indexOf('DROP TABLE `child`'));
		expect(detach).toContain('REFERENCES `parent`(`id`)');
		expect(detach).not.toContain('ON DELETE CASCADE');
	});

	it('restores the real FK action on reattach', () => {
		const reattach = out.slice(out.indexOf('-- reattach child'));
		expect(reattach).toContain('ON DELETE CASCADE');
	});

	it('frames the migration in defer_foreign_keys and drops the inert pragma', () => {
		expect(out).toContain('PRAGMA defer_foreign_keys=ON;');
		expect(out.trimEnd().endsWith('PRAGMA defer_foreign_keys=OFF;')).toBe(true);
		// PRAGMA foreign_keys is a silent no-op inside D1's transaction; leaving it
		// in would imply a protection that isn't there. It may still appear in the
		// explanatory header comment, so only executable statements are checked.
		const executable = out
			.split('\n')
			.filter((line) => !line.trimStart().startsWith('--'))
			.join('\n');
		expect(executable).not.toMatch(/PRAGMA\s+foreign_keys/i);
	});

	it('keeps the original rebuild statements', () => {
		expect(out).toContain('CREATE TABLE `__new_parent`');
		expect(out).toContain('ALTER TABLE `__new_parent` RENAME TO `parent`;');
	});

	it('is idempotent — an already-rewritten migration is left alone', () => {
		expect(rewriteMigration(out, snapshot)).toBeNull();
	});

	it('leaves a rebuild with no FK children untouched', () => {
		const noKids = generated.replaceAll('parent', 'sibling');
		expect(rewriteMigration(noKids, snapshot)).toBeNull();
	});

	it('does nothing to a migration that rebuilds no tables', () => {
		expect(rewriteMigration('ALTER TABLE `band` ADD `claim_status` text;', snapshot)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Comment placement
// ---------------------------------------------------------------------------
// drizzle-kit POSTs each `--> statement-breakpoint` chunk to D1 as one
// statement. A chunk holding only comments has none, and D1 rejects the entire
// migration with `7500: SQL code did not contain a statement`.

describe('collapseCommentOnlyChunks', () => {
	const BREAK = '--> statement-breakpoint';

	function chunksWithoutStatements(sql: string): string[] {
		return sql.split(BREAK).filter(
			(chunk) =>
				chunk
					.split('\n')
					.map((line) => line.trim())
					.filter((line) => line && !line.startsWith('--')).length === 0
		);
	}

	/**
	 * `collapseCommentOnlyChunks` returns null when there is nothing to collapse.
	 * Every case below has something to collapse, so assert that once here rather
	 * than re-narrowing `string | null` in each test.
	 */
	function collapse(sql: string): string {
		const out = collapseCommentOnlyChunks(sql);
		expect(out, 'expected a collapse, got null').not.toBeNull();
		return out as string;
	}

	it('returns null when every chunk already carries a statement', () => {
		const sql = `SELECT 1;\n${BREAK}\n-- explains the next one\nSELECT 2;\n`;
		expect(collapseCommentOnlyChunks(sql)).toBeNull();
	});

	it('moves a lone comment onto the statement it describes', () => {
		const sql = `-- why we defer\n${BREAK}\nPRAGMA defer_foreign_keys=ON;\n`;

		const out = collapse(sql);

		expect(chunksWithoutStatements(out)).toEqual([]);
		expect(out).toContain('-- why we defer\nPRAGMA defer_foreign_keys=ON;');
	});

	it('keeps consecutive comment lines together, in order', () => {
		const sql = `-- first\n${BREAK}\n-- second\n${BREAK}\nSELECT 1;\n`;

		const out = collapse(sql);

		expect(chunksWithoutStatements(out)).toEqual([]);
		expect(out).toContain('-- first\n-- second\nSELECT 1;');
	});

	it('parks trailing comments on the preceding statement', () => {
		const sql = `SELECT 1;\n${BREAK}\n-- nothing follows this\n`;

		const out = collapse(sql);

		expect(chunksWithoutStatements(out)).toEqual([]);
		expect(out).toContain('SELECT 1;\n-- nothing follows this');
	});

	it('preserves every statement', () => {
		const sql = `-- a\n${BREAK}\nSELECT 1;\n${BREAK}\n-- b\n${BREAK}\nSELECT 2;\n`;

		const out = collapse(sql);

		expect(out).toContain('SELECT 1;');
		expect(out).toContain('SELECT 2;');
	});

	it('is idempotent', () => {
		const sql = `-- a\n${BREAK}\nSELECT 1;\n`;
		const once = collapseCommentOnlyChunks(sql);

		expect(collapseCommentOnlyChunks(once)).toBeNull();
	});
});
