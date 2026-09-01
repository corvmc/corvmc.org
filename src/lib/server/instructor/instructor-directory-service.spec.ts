/**
 * **The exposure test.**
 *
 * The instructor listing is the only public, unauthenticated surface in this
 * module, and every risk in it is a `WHERE` clause or a gate applied to a
 * fallback. A mocked `db` returns whatever the mock decides, so it would pass
 * with any of these predicates deleted — the shape of the query is not the
 * question, which rows come back is. Hence real SQLite on the real migrated
 * tables.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.mock('$lib/server/db', async () => {
	const { DatabaseSync } = await import('node:sqlite');
	const { drizzle } = await import('drizzle-orm/node-sqlite');
	const { migrate } = await import('drizzle-orm/node-sqlite/migrator');
	const { join } = await import('node:path');
	const client = new DatabaseSync(':memory:');
	const orm = drizzle({ client });
	migrate(orm, {
		migrationsFolder: join(import.meta.dirname, '..', '..', '..', '..', 'migrations')
	});
	return { db: orm, client, getRowCount: () => 0 };
});

const { client } = (await import('$lib/server/db')) as unknown as {
	client: import('node:sqlite').DatabaseSync;
};
const { listInstructors } = await import('./instructor-directory-service');

let seq = 0;

/** One instructor with a directory entry, tunable on every axis a gate reads. */
function addInstructor(opts: {
	name: string;
	status?: string;
	acceptingStudents?: boolean;
	entryVisibility?: string;
	entryContact?: unknown;
	teachingContact?: unknown;
	instruments?: string[];
	userDeleted?: boolean;
	entryDeleted?: boolean;
	withEntry?: boolean;
}) {
	const n = ++seq;
	const uid = `u-${n}`;
	const q = (v: unknown) => (v == null ? 'null' : `'${JSON.stringify(v)}'`);

	client.exec(
		`INSERT INTO user (id, name, email, email_verified, created_at, updated_at, deleted_at)
		 VALUES ('${uid}', '${opts.name}', 'u${n}@x.com', 0, unixepoch(), unixepoch(),
		         ${opts.userDeleted ? 'unixepoch()' : 'null'})`
	);
	client.exec(
		`INSERT INTO instructor (id, user_id, status, accepting_students, headline,
		                         application_note, teaching_contact, created_at, updated_at)
		 VALUES ('i-${n}', '${uid}', '${opts.status ?? 'active'}',
		         ${opts.acceptingStudents === false ? 0 : 1}, 'Teaches ${opts.name}',
		         'PRIVATE application note', ${q(opts.teachingContact)}, unixepoch(), unixepoch())`
	);
	if (opts.withEntry !== false) {
		client.exec(
			`INSERT INTO directory_entry (id, user_id, name, visibility, contact, created_at, updated_at, deleted_at)
			 VALUES ('e-${n}', '${uid}', '${opts.name}', '${opts.entryVisibility ?? 'public'}',
			         ${q(opts.entryContact)}, unixepoch(), unixepoch(),
			         ${opts.entryDeleted ? 'unixepoch()' : 'null'})`
		);
		for (const inst of opts.instruments ?? []) {
			client.exec(
				`INSERT INTO directory_tag (entry_id, kind, value) VALUES ('e-${n}', 'instrument', '${inst}')`
			);
		}
	}
	return uid;
}

beforeEach(() => {
	for (const t of ['directory_tag', 'directory_entry', 'instructor', 'user']) {
		client.exec(`DELETE FROM ${t}`);
	}
});

afterAll(() => client.close());

describe('gate 1 — only an approved instructor is listed', () => {
	it.each(['requested', 'rejected', 'paused', 'retired'])(
		'never lists a %s record, publicly or to members',
		async (status) => {
			// An application IS the draft listing — a real row in a real table, one
			// missing predicate from the public page. This is that predicate.
			addInstructor({ name: 'Applicant', status });
			expect(await listInstructors('public')).toHaveLength(0);
			expect(await listInstructors('members')).toHaveLength(0);
		}
	);

	it('lists an active one', async () => {
		addInstructor({ name: 'Ada' });
		expect(await listInstructors('public')).toHaveLength(1);
	});
});

describe('gate 2 — the member’s own visibility choice is respected', () => {
	it('withholds a members-only listing from the public page', async () => {
		addInstructor({ name: 'Ada', entryVisibility: 'members' });
		expect(await listInstructors('public')).toHaveLength(0);
		expect(await listInstructors('members')).toHaveLength(1);
	});

	it('never lists a hidden entry, to anyone', async () => {
		addInstructor({ name: 'Ada', entryVisibility: 'hidden' });
		expect(await listInstructors('public')).toHaveLength(0);
		expect(await listInstructors('members')).toHaveLength(0);
	});

	it('skips a soft-deleted entry and a deleted user', async () => {
		addInstructor({ name: 'Gone', entryDeleted: true });
		addInstructor({ name: 'Left', userDeleted: true });
		expect(await listInstructors('members')).toHaveLength(0);
	});

	it('skips an instructor who has no directory entry at all', async () => {
		// A real state: the grant does not create an entry. They simply do not
		// appear until they have a profile.
		addInstructor({ name: 'NoProfile', withEntry: false });
		expect(await listInstructors('public')).toHaveLength(0);
	});
});

describe('gate 3 — the contact fallback is gated, not a bypass', () => {
	it('publishes a public teaching contact', async () => {
		addInstructor({
			name: 'Ada',
			teachingContact: { email: 'teach@x.com', visibility: 'public' }
		});
		const [row] = await listInstructors('public');
		expect(row.contact?.email).toBe('teach@x.com');
	});

	it('falls back to the member’s own contact when no teaching one is set', async () => {
		addInstructor({ name: 'Ada', entryContact: { email: 'me@x.com', visibility: 'public' } });
		const [row] = await listInstructors('public');
		expect(row.contact?.email).toBe('me@x.com');
	});

	it('does NOT publish a members-only contact through the fallback', async () => {
		// The case where a passing test and a leaking page look identical from the
		// outside: the instructor is listed either way, and only the contact field
		// differs. Publishing it would be this module overriding a privacy choice
		// the member made somewhere else entirely.
		addInstructor({ name: 'Ada', entryContact: { email: 'me@x.com', visibility: 'members' } });

		const [pub] = await listInstructors('public');
		expect(pub.contact).toBeNull();
		expect(pub.contactWithheld).toBe(true);

		const [mem] = await listInstructors('members');
		expect(mem.contact?.email).toBe('me@x.com');
	});

	it('prefers the teaching contact over the member’s, rather than merging them', async () => {
		addInstructor({
			name: 'Ada',
			entryContact: { phone: '555-0000', visibility: 'public' },
			teachingContact: { email: 'teach@x.com', visibility: 'public' }
		});
		const [row] = await listInstructors('public');
		expect(row.contact?.email).toBe('teach@x.com');
		expect(row.contact?.phone).toBeUndefined();
	});
});

describe('the whitelist', () => {
	it('never returns applicationNote, which is staff-only', async () => {
		addInstructor({ name: 'Ada' });
		const [row] = await listInstructors('public');
		expect(JSON.stringify(row)).not.toContain('PRIVATE application note');
		expect(row).not.toHaveProperty('applicationNote');
	});
});

describe('acceptingStudents', () => {
	it('drops an instructor with a full book from the listing', async () => {
		// Their own switch, and it governs the listing only — they keep booking.
		addInstructor({ name: 'Full', acceptingStudents: false });
		expect(await listInstructors('public')).toHaveLength(0);
	});
});

describe('filters', () => {
	it('filters by instrument through the tags on the entry', async () => {
		addInstructor({ name: 'Guitarist', instruments: ['Guitar'] });
		addInstructor({ name: 'Drummer', instruments: ['Drums'] });

		const guitar = await listInstructors('public', { instrument: 'Guitar' });
		expect(guitar.map((r) => r.name)).toEqual(['Guitarist']);
		expect(guitar[0].instruments).toEqual(['Guitar']);
	});

	it('searches by name, case-insensitively', async () => {
		addInstructor({ name: 'Ada' });
		addInstructor({ name: 'Grace' });
		expect((await listInstructors('public', { search: 'ad' })).map((r) => r.name)).toEqual(['Ada']);
	});
});
