import { describe, it, expect, beforeEach, vi } from 'vitest';

/** An event's History against a real SQLite: its show's rows arrive through a join. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { listEventHistory } = await import('./event-history');

let seq = 0;
function audit(subjectType: string, subjectId: string, action: string, at: number) {
	sqlite
		.prepare(
			`insert into audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, details, created_at)
			 values (?, ?, null, 'Sam', 's@x.test', ?, ?, '{"fields":[]}', ?)`
		)
		.run(`a-${++seq}`, action, subjectType, subjectId, at);
}

beforeEach(() => {
	seq = 0;
	for (const t of ['audit_log', 'event_listing', 'production', 'project', 'user'])
		sqlite.exec(`delete from ${t}`);
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values ('u', 'Staff', 'u@x.test', 0)`
	);
	for (const p of ['proj', 'other']) {
		sqlite.exec(`insert into project (id, name, kind) values ('${p}', '${p}', 'production')`);
		sqlite.exec(
			`insert into production (id, project_id, status) values ('prod-${p}', '${p}', 'draft')`
		);
	}
	for (const [id, project] of [
		['ev', 'proj'],
		['ev-other', 'other']
	]) {
		sqlite.exec(
			`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, status, project_id)
			 values ('${id}', 'Show', 1900000000, 1900007200, 'u', 'cmc', 'show', 'draft', '${project}')`
		);
	}
});

describe('listEventHistory', () => {
	it("merges the listing's entries with its own show's, newest first, and nobody else's", async () => {
		audit('event', 'ev', 'event.edited_while_cancelled', 100);
		audit('production', 'prod-proj', 'production.status_changed', 200);
		audit('production', 'prod-other', 'production.status_changed', 300);
		audit('event', 'ev-other', 'event.edited_while_cancelled', 400);

		const page = await listEventHistory('ev');

		expect(page.items.map((i) => i.id)).toEqual(['audit:a-2', 'audit:a-1']);
		expect(page.hasMore).toBe(false);
	});

	it('pages with limit + 1', async () => {
		for (let i = 0; i < 3; i++) audit('event', 'ev', 'event.edited_while_cancelled', i);
		const page = await listEventHistory('ev', { limit: 2 });
		expect(page.items).toHaveLength(2);
		expect(page.hasMore).toBe(true);
	});
});
