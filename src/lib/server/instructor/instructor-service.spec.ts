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

const { client } = (await import('$lib/server/db')) as unknown as {
	client: import('node:sqlite').DatabaseSync;
};
const svc = await import('./instructor-service');
const { requireInstructor } = await import('./instructor-context');

const USER = 'user-teacher';
const STAFF = 'user-staff';

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
		await svc.apply(USER, { headline: 'Guitar, beginners welcome', applicationNote: 'Ten years.' });

		const r = row();
		expect(r?.status).toBe('requested');
		expect(r?.headline).toBe('Guitar, beginners welcome');
		// The private half is on the same row and must never reach a listing DTO.
		expect(r?.application_note).toBe('Ten years.');
		// Not granted by anyone yet — the row predates the grant.
		expect(r?.granted_at).toBeNull();
	});

	it('refuses a second application from someone who already has a grant', async () => {
		await svc.grant(USER, STAFF);
		await expect(svc.apply(USER, { headline: 'again' })).rejects.toThrow(
			svc.AlreadyAnInstructorError
		);
	});
});

describe('the return state', () => {
	it('hands an application back with a note and takes it forward again', async () => {
		await svc.apply(USER, { headline: 'Guitar' });
		const id = row()!.id as string;

		await svc.sendBack(id, STAFF, 'Say which levels you teach.');
		expect(row()?.status).toBe('rejected');
		expect(row()?.review_notes).toBe('Say which levels you teach.');

		await svc.apply(USER, { headline: 'Guitar — beginner to intermediate' });
		expect(row()?.status).toBe('requested');
		expect(row()?.headline).toBe('Guitar — beginner to intermediate');
	});

	it('keeps reviewNotes through a resubmit, and clears it only when staff act', async () => {
		// Clearing on resubmit would delete the question at the moment the answer
		// arrives — the reviewer would see a fresh application and no record of
		// why it came back.
		await svc.apply(USER, { headline: 'Guitar' });
		const id = row()!.id as string;
		await svc.sendBack(id, STAFF, 'Say which levels you teach.');

		await svc.apply(USER, { headline: 'Guitar — beginner to intermediate' });
		expect(row()?.review_notes).toBe('Say which levels you teach.');

		await svc.approve(id, STAFF);
		expect(row()?.review_notes).toBeNull();
	});

	it('requires a note — a return nobody can read is not a return', async () => {
		await svc.apply(USER, { headline: 'Guitar' });
		const id = row()!.id as string;
		await expect(svc.sendBack(id, STAFF, '   ')).rejects.toThrow(svc.InstructorStateError);
		expect(row()?.status).toBe('requested');
	});

	it('lets staff approve straight from rejected without asking for a resubmit', async () => {
		await svc.apply(USER, { headline: 'Guitar' });
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
		await svc.apply(USER, { headline: 'Guitar' });
		await expect(svc.updateListing('someone-else', { headline: 'hijacked' })).rejects.toThrow(
			svc.InstructorNotFoundError
		);
		expect(row()?.headline).toBe('Guitar');
	});

	it('withdraws an open application but never an active grant', async () => {
		await svc.apply(USER, { headline: 'Guitar' });
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
		await svc.apply(USER, { headline: 'Guitar' });
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
		await svc.apply(USER, { headline: 'Guitar' });
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
		await svc.apply(USER, { headline: 'Guitar' });
		client.exec(`UPDATE instructor SET status = 'sabbatical' WHERE user_id = '${USER}'`);

		await expect(requireInstructor(USER)).rejects.toThrow(svc.InstructorNotActiveError);
	});
});
