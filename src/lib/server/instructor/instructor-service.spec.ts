/**
 * Runs the instructor service against **real SQLite**, on the real migrated
 * table.
 *
 * Everything worth pinning here is a `WHERE` clause. `approve` must not promote
 * a retired row, `withdraw` must not delete an active one, and `updateListing`
 * is scoped by `userId` because the id it is given came from the client. A
 * mocked `db` returns whatever the mock decides and would pass all three while
 * the real statements matched the wrong rows — the shape of the query is not the
 * question, its meaning to the engine is.
 *
 * Same approach and the same migration path as `group-invite-upsert.spec.ts`.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const { DatabaseSync } = await import('node:sqlite');
	const { drizzle } = await import('drizzle-orm/node-sqlite');
	const { migrate } = await import('drizzle-orm/node-sqlite/migrator');
	const { join } = await import('node:path');

	const client = new DatabaseSync(':memory:');
	const orm = drizzle({ client });
	migrate(orm, {
		migrationsFolder: join(import.meta.dirname, '..', '..', '..', '..', 'migrations')
	});

	return {
		db: orm,
		client,
		// `getRowCount` reads D1's `meta.changes`; node-sqlite reports `changes` at
		// the top level. Adapting it is the one thing this harness fakes, and it is
		// deliberately the *only* one — the SQL underneath is the real statement.
		getRowCount: (result: unknown) => {
			const r = result as { meta?: { changes?: number }; changes?: number | bigint };
			return Number(r?.meta?.changes ?? r?.changes ?? 0);
		}
	};
});

const { client } = (await import('#lib/server/db/index.js')) as unknown as {
	client: import('node:sqlite').DatabaseSync;
};
const svc = await import('./instructor-service');
const { requireInstructor } = await import('./instructor-context');
const { STAFF_TRANSITIONS } = await import('./instructor-transitions');
type StaffTransition = import('./instructor-transitions').StaffTransition;

const USER = 'user-teacher';
const STAFF = 'user-staff';
const BLURB = 'Lessons for adults, at the studio or online.';

function seedUsers() {
	for (const [id, email] of [
		[USER, 'teacher@example.com'],
		[STAFF, 'staff@example.com']
	]) {
		client.exec(
			`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
			 VALUES ('${id}', '${id}', '${email}', 0, unixepoch(), unixepoch())`
		);
	}
}

function row() {
	return client.prepare(`SELECT * FROM instructor WHERE user_id = ?`).get(USER) as
		Record<string, unknown> | undefined;
}

beforeEach(() => {
	client.exec('DELETE FROM instructor');
	client.exec('DELETE FROM user');
	seedUsers();
});

afterAll(() => client.close());

describe('applying', () => {
	it('creates a requested row carrying the listing, which IS the application', async () => {
		await svc.apply(USER, {
			blurb: BLURB,
			headline: 'Guitar, beginners welcome',
			applicationNote: 'Ten years.'
		});

		const r = row();
		expect(r?.status).toBe('requested');
		expect(r?.headline).toBe('Guitar, beginners welcome');
		// The private half is on the same row and must never reach a listing DTO.
		expect(r?.application_note).toBe('Ten years.');
		// Not granted by anyone yet — the row predates the grant.
		expect(r?.granted_at).toBeNull();
	});

	// An application that says nothing cannot be reviewed; nine reached staff
	// that way from new members submitting every card on their profile (#1820).
	it('refuses an application that does not say what they teach', async () => {
		await expect(svc.apply(USER, { blurb: BLURB })).rejects.toThrow(
			svc.InstructorApplicationIncompleteError
		);
		await expect(svc.apply(USER, { headline: '   ', blurb: BLURB })).rejects.toThrow(
			svc.InstructorApplicationIncompleteError
		);
		expect(row()).toBeUndefined();
	});

	it('refuses an application with no description of the teaching', async () => {
		await expect(svc.apply(USER, { headline: 'Guitar' })).rejects.toThrow(
			svc.InstructorApplicationIncompleteError
		);
		expect(row()).toBeUndefined();
	});

	it('refuses a resubmit that empties the application', async () => {
		await svc.apply(USER, { headline: 'Guitar', blurb: BLURB });
		await svc.sendBack(row()!.id as string, STAFF, 'Say which levels you teach.');

		await expect(svc.apply(USER, { headline: '', blurb: '' })).rejects.toThrow(
			svc.InstructorApplicationIncompleteError
		);
		expect(row()?.headline).toBe('Guitar');
	});

	it('refuses a second application from someone who already has a grant', async () => {
		await svc.grant(USER, STAFF);
		await expect(svc.apply(USER, { blurb: BLURB, headline: 'again' })).rejects.toThrow(
			svc.AlreadyAnInstructorError
		);
	});
});

describe('the return state', () => {
	it('hands an application back with a note and takes it forward again', async () => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		const id = row()!.id as string;

		await svc.sendBack(id, STAFF, 'Say which levels you teach.');
		expect(row()?.status).toBe('rejected');
		expect(row()?.review_notes).toBe('Say which levels you teach.');

		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar — beginner to intermediate' });
		expect(row()?.status).toBe('requested');
		expect(row()?.headline).toBe('Guitar — beginner to intermediate');
	});

	it('keeps reviewNotes through a resubmit, and clears it only when staff act', async () => {
		// Clearing on resubmit would delete the question at the moment the answer
		// arrives — the reviewer would see a fresh application and no record of
		// why it came back.
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		const id = row()!.id as string;
		await svc.sendBack(id, STAFF, 'Say which levels you teach.');

		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar — beginner to intermediate' });
		expect(row()?.review_notes).toBe('Say which levels you teach.');

		await svc.approve(id, STAFF);
		expect(row()?.review_notes).toBeNull();
	});

	it('requires a note — a return nobody can read is not a return', async () => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		const id = row()!.id as string;
		await expect(svc.sendBack(id, STAFF, '   ')).rejects.toThrow(svc.InstructorStateError);
		expect(row()?.status).toBe('requested');
	});

	it('lets staff approve straight from rejected without asking for a resubmit', async () => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		const id = row()!.id as string;
		await svc.sendBack(id, STAFF, 'changes please');

		await svc.approve(id, STAFF);
		expect(row()?.status).toBe('active');
	});
});

describe('approve is scoped to the application states', () => {
	it('cannot promote a retired row back to active', async () => {
		// The scope is the guard. Reinstating is `grant()`, a different decision
		// made by a person, and approve must not become a back door to it.
		await svc.grant(USER, STAFF);
		const id = row()!.id as string;
		await svc.retire(id, STAFF, 'moved away');

		await expect(svc.approve(id, STAFF)).rejects.toThrow(svc.InstructorNotFoundError);
		expect(row()?.status).toBe('retired');
	});

	it('cannot promote a paused row', async () => {
		await svc.grant(USER, STAFF);
		const id = row()!.id as string;
		await svc.pause(id, STAFF, 'off for the summer');

		await expect(svc.approve(id, STAFF)).rejects.toThrow(svc.InstructorNotFoundError);
		expect(row()?.status).toBe('paused');
	});
});

describe('blocking a grant', () => {
	it('requires a note on pause and on retire', async () => {
		await svc.grant(USER, STAFF);
		const id = row()!.id as string;

		await expect(svc.pause(id, STAFF, '')).rejects.toThrow(svc.InstructorStateError);
		await expect(svc.retire(id, STAFF, '  ')).rejects.toThrow(svc.InstructorStateError);
		expect(row()?.status).toBe('active');
	});

	it('retires without touching anything else — bookings are a separate decision', async () => {
		// A booked lesson has a student on the other end who has already been told
		// a time. Nothing here may cancel one as a side effect.
		await svc.grant(USER, STAFF);
		const id = row()!.id as string;
		await svc.retire(id, STAFF, 'moved away');

		const r = row()!;
		expect(r.status).toBe('retired');
		expect(r.granted_at).not.toBeNull();
		expect(r.status_note).toBe('moved away');
	});

	it('grant is the way back from retired', async () => {
		await svc.grant(USER, STAFF);
		const id = row()!.id as string;
		await svc.retire(id, STAFF, 'moved away');

		await svc.grant(USER, STAFF);
		expect(row()?.status).toBe('active');
		// The reason they were off the list is spent once they are back on it.
		expect(row()?.status_note).toBeNull();
	});
});

describe('the member cannot reach past their own row', () => {
	it('scopes updateListing by userId, not by the id the client sent', async () => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		await expect(svc.updateListing('someone-else', { headline: 'hijacked' })).rejects.toThrow(
			svc.InstructorNotFoundError
		);
		expect(row()?.headline).toBe('Guitar');
	});

	it('withdraws an open application but never an active grant', async () => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		await svc.withdraw(USER);
		expect(row()).toBeUndefined();

		await svc.grant(USER, STAFF);
		await expect(svc.withdraw(USER)).rejects.toThrow(svc.InstructorNotFoundError);
		expect(row()?.status).toBe('active');
	});

	it('lets an active instructor edit their listing and close their book', async () => {
		await svc.grant(USER, STAFF);
		await svc.updateListing(USER, { headline: 'Guitar and bass' });
		await svc.setAcceptingStudents(USER, false);

		expect(row()?.headline).toBe('Guitar and bass');
		expect(row()?.accepting_students).toBe(0);
	});

	it('refuses setAcceptingStudents while the application is still open', async () => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		await expect(svc.setAcceptingStudents(USER, false)).rejects.toThrow(
			svc.InstructorNotFoundError
		);
	});
});

describe('requireInstructor matches positively', () => {
	it('admits only active', async () => {
		await svc.grant(USER, STAFF);
		await expect(requireInstructor(USER)).resolves.toMatchObject({ status: 'active' });
	});

	it.each(['requested', 'rejected', 'paused', 'retired'])('refuses %s', async (status) => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		client.exec(`UPDATE instructor SET status = '${status}' WHERE user_id = '${USER}'`);

		await expect(requireInstructor(USER)).rejects.toThrow(svc.InstructorNotActiveError);
	});

	it('refuses a member with no record at all', async () => {
		await expect(requireInstructor(USER)).rejects.toThrow(svc.InstructorNotFoundError);
	});

	it('would refuse a status nobody has thought of yet', async () => {
		// The point of `!== 'active'` over `!== 'retired'`: a sixth value added
		// tomorrow is refused without anyone revisiting this guard. Written as a
		// negation of the terminal state, every new value would be admitted.
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		client.exec(`UPDATE instructor SET status = 'sabbatical' WHERE user_id = '${USER}'`);

		await expect(requireInstructor(USER)).rejects.toThrow(svc.InstructorNotActiveError);
	});
});

describe('what gets announced', () => {
	// The events are real here — only the database is substituted — so this
	// asserts the emit actually happens rather than that a mock was called.
	async function captureEvents<T>(name: T, run: () => Promise<void>) {
		const { domainEvents } = await import('#lib/server/event-bus/event-bus.js');
		const seen: Record<string, unknown>[] = [];
		const off = domainEvents.on(name as never, (e: unknown) => {
			seen.push((e as { data: Record<string, unknown> }).data);
		});
		await run();
		// The emits are deliberately not awaited by the service, so give the
		// microtask queue a turn before reading.
		await new Promise((r) => setTimeout(r, 0));
		off();
		return seen;
	}

	it('tells staff when an application arrives', async () => {
		const seen = await captureEvents('instructor.application_submitted', () =>
			svc.apply(USER, { blurb: BLURB, headline: 'Guitar' })
		);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ applicantUserId: USER, headline: 'Guitar' });
	});

	it('tells staff again when a returned application comes back', async () => {
		// The resubmit is exactly when it needs looking at again; without this it
		// would sit in the queue with nobody told.
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		const id = row()!.id as string;
		await svc.sendBack(id, STAFF, 'which levels?');

		const seen = await captureEvents('instructor.application_submitted', () =>
			svc.apply(USER, { blurb: BLURB, headline: 'Guitar, beginner to intermediate' })
		);
		expect(seen).toHaveLength(1);
	});

	it('carries the note to the member when it is sent back', async () => {
		// The load-bearing half of the return state: the member is not watching
		// their profile, so a note nobody delivers is the failure it exists to
		// prevent.
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		const id = row()!.id as string;

		const seen = await captureEvents('instructor.application_reviewed', () =>
			svc.sendBack(id, STAFF, 'Say which levels you teach.')
		);
		expect(seen[0]).toMatchObject({
			approved: false,
			reviewNotes: 'Say which levels you teach.',
			applicantUserId: USER
		});
	});

	it('announces an approval with no note', async () => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		const id = row()!.id as string;

		const seen = await captureEvents('instructor.application_reviewed', () =>
			svc.approve(id, STAFF)
		);
		expect(seen[0]).toMatchObject({ approved: true, reviewNotes: null });
	});

	it('says nothing when the transition did not happen', async () => {
		// `approve` on a retired row throws and changes nothing, so it must not
		// tell the member they were approved.
		await svc.grant(USER, STAFF);
		const id = row()!.id as string;
		await svc.retire(id, STAFF, 'moved away');

		const seen = await captureEvents('instructor.application_reviewed', async () => {
			await expect(svc.approve(id, STAFF)).rejects.toThrow();
		});
		expect(seen).toHaveLength(0);
	});
});

describe('every staff transition tells the member', () => {
	// Pause and retire once changed a teacher's status in silence (#2811). Typed
	// over STAFF_TRANSITIONS, so a new transition cannot ship without a row here.
	const MEMBER_EVENTS = ['instructor.application_reviewed', 'instructor.status_ended'] as const;
	const setUp = async () => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		return row()!.id as string;
	};
	const toActive = async () => {
		const id = await setUp();
		await svc.approve(id, STAFF);
		return id;
	};
	const cases: Record<
		StaffTransition,
		{ arrange: () => Promise<string>; act: (id: string) => Promise<void> }
	> = {
		approve: { arrange: setUp, act: (id) => svc.approve(id, STAFF) },
		sendBack: { arrange: setUp, act: (id) => svc.sendBack(id, STAFF, 'Say which levels.') },
		pause: { arrange: toActive, act: (id) => svc.pause(id, STAFF, 'off for the summer') },
		retire: { arrange: toActive, act: (id) => svc.retire(id, STAFF, 'moved away') },
		grant: {
			arrange: async () => {
				const id = await toActive();
				await svc.retire(id, STAFF, 'moved away');
				return id;
			},
			act: () => svc.grant(USER, STAFF)
		}
	};

	it.each(Object.keys(STAFF_TRANSITIONS) as StaffTransition[])('%s', async (transition) => {
		const { domainEvents } = await import('#lib/server/event-bus/event-bus.js');
		const id = await cases[transition].arrange();
		const seen: { userId?: string; applicantUserId?: string }[] = [];
		const offs = MEMBER_EVENTS.map((name) =>
			domainEvents.on(name, (e) => {
				seen.push(e.data as never);
			})
		);
		await cases[transition].act(id);
		await new Promise((r) => setTimeout(r, 0));
		offs.forEach((off) => off());

		expect(seen.map((e) => e.userId ?? e.applicantUserId)).toEqual([USER]);
	});

	it('grants a member with no application and tells them', async () => {
		const { domainEvents } = await import('#lib/server/event-bus/event-bus.js');
		const seen: unknown[] = [];
		const off = domainEvents.on('instructor.application_reviewed', (e) => {
			seen.push(e.data);
		});
		await svc.grant(USER, STAFF);
		await new Promise((r) => setTimeout(r, 0));
		off();

		expect(seen).toEqual([expect.objectContaining({ applicantUserId: USER, approved: true })]);
	});

	it('does not carry the staff note to the teacher', async () => {
		const { domainEvents } = await import('#lib/server/event-bus/event-bus.js');
		const id = await toActive();
		const seen: unknown[] = [];
		const off = domainEvents.on('instructor.status_ended', (e) => {
			seen.push(e.data);
		});
		await svc.pause(id, STAFF, 'complaint from a student');
		await new Promise((r) => setTimeout(r, 0));
		off();

		expect(seen).toEqual([
			{ instructorId: id, userId: USER, name: USER, email: 'teacher@example.com', status: 'paused' }
		]);
	});
});

describe('future teaching bookings', () => {
	it('counts only the instructor’s future, uncancelled teaching bookings', async () => {
		await svc.grant(USER, STAFF);
		const id = row()!.id as string;
		const now = Math.floor(Date.now() / 1000);
		const add = (rid: string, type: string, booker: string, start: number, status: string) =>
			client.exec(
				`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
				 VALUES ('${rid}', '${type}', '${booker}', '${USER}', '${status}', ${start}, ${start + 3600})`
			);
		add('next', 'instructor', id, now + 86400, 'confirmed');
		add('later', 'instructor', id, now + 2 * 86400, 'confirmed');
		add('past', 'instructor', id, now - 86400, 'confirmed');
		add('cancelled', 'instructor', id, now + 86400, 'cancelled');
		add('own', 'user', USER, now + 86400, 'confirmed');

		expect((await svc.futureTeachingBookings([id])).get(id)).toBe(2);
		client.exec('DELETE FROM reservation');
	});
});

describe('the Members instructors view', () => {
	it('filters by status and search, and counts pending whatever the filter', async () => {
		await svc.apply(USER, { blurb: BLURB, headline: 'Guitar' });
		await svc.grant(STAFF, STAFF);

		const pending = await svc.listInstructorRoster({ status: 'requested' });
		expect(pending.rows.map((r) => r.personId)).toEqual([USER]);
		expect(pending.rows[0]).toMatchObject({ email: 'teacher@example.com', headline: 'Guitar' });

		const teaching = await svc.listInstructorRoster({ status: 'active' });
		expect(teaching.rows.map((r) => r.personId)).toEqual([STAFF]);
		expect(teaching.pending).toBe(1);

		const found = await svc.listInstructorRoster({ search: 'teacher@' });
		expect(found.rows.map((r) => r.personId)).toEqual([USER]);
		expect(found.pagination.total).toBe(1);
	});

	it('carries the listing as it would publish, and where it would show', async () => {
		await svc.apply(USER, {
			headline: 'Guitar',
			blurb: BLURB,
			ratesNote: '$40 an hour',
			bookingUrl: 'https://example.com/book'
		});

		const [r] = (await svc.listInstructorRoster({ status: 'requested' })).rows;
		expect(r).toMatchObject({
			headline: 'Guitar',
			blurb: BLURB,
			ratesNote: '$40 an hour',
			bookingUrl: 'https://example.com/book',
			// No profile saved, so no directory entry: approving would list nobody.
			directoryReach: 'missing'
		});
	});
});
