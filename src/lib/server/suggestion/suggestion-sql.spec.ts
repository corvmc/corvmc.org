import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Merge and direct edit against a real SQLite: the vote dedup is the unique index, not the code. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/audit/audit-service.js', () => ({ recordAuditEntry: vi.fn() }));

const { mergeSuggestions, editSuggestion, countVotes, listSuggestions } =
	await import('./suggestion-service');

const row = (id: string) =>
	sqlite
		.prepare('select title, body, merged_into_id, edited_at from suggestion where id = ?')
		.get(id) as {
		title: string;
		body: string;
		merged_into_id: string | null;
		edited_at: number | null;
	};

beforeEach(() => {
	sqlite.exec('delete from suggestion_vote');
	sqlite.exec('delete from suggestion_edit');
	sqlite.exec('delete from suggestion');
	sqlite.exec(
		`insert into suggestion (id, author_user_id, title, body) values
			('target', 'author', 'Target', 'Target body'),
			('source', 'author', 'Source', 'Source body'),
			('unvoted', 'author', 'Unvoted', 'Unvoted body')`
	);
	// The reporter voted for both, so the union is 4 and the sum would be 5.
	sqlite.exec(
		`insert into suggestion_vote (id, suggestion_id, user_id) values
			('v1', 'target', 'author'),
			('v2', 'target', 'reporter'),
			('v3', 'target', 'bystander'),
			('v4', 'source', 'reporter'),
			('v5', 'source', 'staff'),
			('v6', 'unvoted', 'author')`
	);
});

describe('mergeSuggestions', () => {
	it('leaves the target with the union of both voter sets, not the sum', async () => {
		await mergeSuggestions({ sourceId: 'source', targetId: 'target', staffId: 'staff' });

		expect(await countVotes('target')).toBe(4);
		expect(row('source').merged_into_id).toBe('target');
	});

	it('takes the source off the board', async () => {
		await mergeSuggestions({ sourceId: 'source', targetId: 'target', staffId: 'staff' });

		const { rows } = await listSuggestions({}, { page: 1, pageSize: 50 });
		expect(rows.map((r) => r.id).sort()).toEqual(['target', 'unvoted']);
	});
});

describe('editSuggestion', () => {
	it('rewrites in place and stamps editedAt while only the author has voted', async () => {
		const result = await editSuggestion('unvoted', {
			title: 'Rewritten',
			body: 'Rewritten body',
			category: 'other',
			userId: 'author'
		});

		expect(result).toEqual({ applied: true, editId: null });
		expect(row('unvoted')).toMatchObject({ title: 'Rewritten', body: 'Rewritten body' });
		expect(row('unvoted').edited_at).not.toBeNull();
	});
});
