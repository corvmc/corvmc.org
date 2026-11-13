import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A party's notes, timeline and list facts (#2622), against a real SQLite with
 * foreign keys on. People rows are written with raw SQL, so this file never
 * names the guarded contact table.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const handle = migratedSqlite({ foreignKeys: true });
	return { sqlite: handle.sqlite, testDb: withBatch(handle) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
	requireUser: () => ({ id: 'staff-1' })
}));

const notes = await import('./activity-service');
const { partyTimeline } = await import('./timeline');
const { organizationListFacts } = await import('./list-facts');
const orgs = await import('./organization-service');
const people = await import('#lib/server/directory/contact-service.js');

const ARTS = { type: 'organization', id: 'org-arts' } as const;
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

beforeEach(() => {
	sqlite.exec(`
		delete from activity; delete from work_order_link; delete from audit_log;
		delete from contractor_job; delete from grant_application; delete from work_order;
		delete from project; delete from party_role; delete from contact; delete from organization;
		delete from user;
		insert into user (id, name, email) values ('staff-1', 'Nia Okafor', 'nia@example.test');
		insert into organization (id, name) values ('org-arts', 'Arts Council'), ('org-old', 'Arts Cncl'),
			('org-amps', 'Amp Shop');
		insert into contact (id, organization_id, name, source) values
			('p-1', 'org-arts', 'Priya', 'staff_entered'), ('p-2', null, 'Priya N', 'staff_entered');
	`);
});

describe('notes', () => {
	it('refuses an empty note or a missing day', async () => {
		await expect(
			notes.addActivity(ARTS, { kind: 'call', occurredOn: '2026-11-01', body: '  ' }, 'staff-1')
		).rejects.toBeInstanceOf(notes.ActivityValidationError);
		await expect(
			notes.addActivity(ARTS, { kind: 'call', occurredOn: 'soon', body: 'Rang' }, 'staff-1')
		).rejects.toBeInstanceOf(notes.ActivityValidationError);
	});

	it('edits and deletes a note, and says whose timeline it was on', async () => {
		const { id } = await notes.addActivity(
			ARTS,
			{ kind: 'call', occurredOn: '2026-11-01', body: 'Rang about spring' },
			'staff-1'
		);
		expect(
			await notes.updateActivity(id, { kind: 'email', occurredOn: '2026-11-02', body: 'Wrote' })
		).toEqual(ARTS);
		expect(await notes.deleteActivity(id)).toEqual(ARTS);
		await expect(notes.deleteActivity(id)).rejects.toBeInstanceOf(notes.ActivityNotFoundError);
	});
});

describe('the timeline', () => {
	beforeEach(() => {
		sqlite.exec(`
			insert into project (id, name, kind, status) values ('proj-grant', 'Spring grant', 'grant', 'in_progress');
			insert into grant_application (id, title, organization_id, project_id, status) values
				('ga', 'Spring', 'org-arts', 'proj-grant', 'applied');
			insert into work_order (id, title, resolved_at, resolved_by_user_id) values
				('wo-done', 'Send the report', ${sec('2026-11-05T18:00:00Z')}, 'staff-1');
			insert into work_order (id, title) values ('wo-open', 'Call again');
			insert into work_order_link (id, work_order_id, organization_id) values
				('l-1', 'wo-done', 'org-arts'), ('l-2', 'wo-open', 'org-arts');
			insert into audit_log (id, action, actor_name, actor_email, subject_type, subject_id, details, created_at)
				values ('a-1', 'project.status_changed', 'Nia', 'nia@x', 'project', 'proj-grant',
					'{"from":"planning","to":"in_progress"}', ${sec('2026-11-03T18:00:00Z')}),
				('a-2', 'project.status_changed', 'Nia', 'nia@x', 'project', 'other',
					'{"from":"planning","to":"in_progress"}', ${sec('2026-11-04T18:00:00Z')});
		`);
	});

	it('merges notes, its grant project entries and done tasks, newest first', async () => {
		await notes.addActivity(
			ARTS,
			{ kind: 'call', occurredOn: '2026-11-01', body: 'Rang about spring' },
			'staff-1'
		);
		const page = await partyTimeline(ARTS);
		expect(page.items.map((i) => [i.source, i.id])).toEqual([
			['task', 'task:wo-done'],
			['audit', 'audit:a-1'],
			['note', expect.stringMatching(/^note:/)]
		]);
		expect(page.items[2]).toMatchObject({ actorName: 'Nia Okafor', summary: 'Rang about spring' });
		expect(page.hasMore).toBe(false);
	});

	it('pages exactly', async () => {
		const page = await partyTimeline(ARTS, { limit: 1 });
		expect(page.items).toHaveLength(1);
		expect(page.hasMore).toBe(true);
	});

	it("keeps a person's timeline to their own notes", async () => {
		await notes.addActivity(
			{ type: 'contact', id: 'p-1' },
			{ kind: 'meeting', occurredOn: '2026-11-02', body: 'Coffee' },
			'staff-1'
		);
		const page = await partyTimeline({ type: 'contact', id: 'p-1' });
		expect(page.items.map((i) => i.summary)).toEqual(['Coffee']);
	});
});

describe('the Contacts list facts', () => {
	it('gives each organization its latest note day and soonest open task', async () => {
		sqlite.exec(`
			insert into work_order (id, title, due_at) values
				('wo-late', 'Later', ${sec('2026-12-20T20:00:00Z')}),
				('wo-soon', 'Sooner', ${sec('2026-12-01T20:00:00Z')}),
				('wo-undated', 'Whenever', null),
				('wo-job', 'Retube', null);
			insert into work_order_link (id, work_order_id, organization_id) values
				('l-1', 'wo-late', 'org-arts'), ('l-2', 'wo-soon', 'org-arts'), ('l-3', 'wo-undated', 'org-arts');
			insert into contractor_job (id, organization_id, work_order_id, status) values
				('job', 'org-amps', 'wo-job', 'asked');
		`);
		await notes.addActivity(ARTS, { kind: 'note', occurredOn: '2026-10-01', body: 'a' }, 'staff-1');
		await notes.addActivity(ARTS, { kind: 'note', occurredOn: '2026-11-01', body: 'b' }, 'staff-1');

		const facts = await organizationListFacts(['org-arts', 'org-amps', 'org-old']);
		expect(facts.lastActivity).toEqual(new Map([['org-arts', '2026-11-01']]));
		expect(facts.nextTask.get('org-arts')).toMatchObject({ id: 'wo-soon', title: 'Sooner' });
		expect(facts.nextTask.get('org-amps')).toMatchObject({ id: 'wo-job' });
		expect(facts.nextTask.has('org-old')).toBe(false);
	});
});

describe('merges', () => {
	it("moves an organization's notes and task links to the survivor", async () => {
		sqlite.exec(`
			insert into work_order (id, title) values ('wo-both', 'Both'), ('wo-old', 'Old');
			insert into work_order_link (id, work_order_id, organization_id) values
				('l-1', 'wo-both', 'org-arts'), ('l-2', 'wo-both', 'org-old'), ('l-3', 'wo-old', 'org-old');
		`);
		await notes.addActivity(
			{ type: 'organization', id: 'org-old' },
			{ kind: 'note', occurredOn: '2026-11-01', body: 'Old note' },
			'staff-1'
		);
		await orgs.mergeOrganizations('org-arts', 'org-old');
		expect(
			sqlite
				.prepare(
					`select work_order_id, organization_id from work_order_link order by work_order_id`
				)
				.all()
		).toEqual([
			{ work_order_id: 'wo-both', organization_id: 'org-arts' },
			{ work_order_id: 'wo-old', organization_id: 'org-arts' }
		]);
		expect(sqlite.prepare(`select organization_id from activity`).all()).toEqual([
			{ organization_id: 'org-arts' }
		]);
	});

	it("moves a person's notes and task links to the survivor", async () => {
		sqlite.exec(`
			insert into work_order (id, title) values ('wo-p', 'Ring her');
			insert into work_order_link (id, work_order_id, contact_id) values ('l-1', 'wo-p', 'p-2');
		`);
		await notes.addActivity(
			{ type: 'contact', id: 'p-2' },
			{ kind: 'call', occurredOn: '2026-11-01', body: 'Rang' },
			'staff-1'
		);
		await people.mergeContacts('p-1', 'p-2');
		expect(sqlite.prepare(`select contact_id from work_order_link`).all()).toEqual([
			{ contact_id: 'p-1' }
		]);
		expect(sqlite.prepare(`select contact_id from activity`).all()).toEqual([
			{ contact_id: 'p-1' }
		]);
	});
});
