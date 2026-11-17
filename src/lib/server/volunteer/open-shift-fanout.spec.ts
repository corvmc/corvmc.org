import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Members hear about a new shift in a role they picked (#3239), against a real
 * SQLite: who is owed what is a set of WHERE clauses, and the latch is a unique
 * index. Shifts are inserted as raw rows, which is the point: the send reads new
 * rows, so it does not care which code path wrote them.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/outbox/outbox-service.js', () => ({ deliverSoon: vi.fn() }));
vi.mock('#lib/server/notification/sse.js', () => ({ pushToUser: vi.fn() }));

const { announceOpenShifts, SHIFT_DIGEST_KEY, SHIFT_OPENED_TYPE } =
	await import('./open-shift-fanout');

// 9:30am PDT: a digest is owed on the first pass of the day.
const NOW = new Date('2031-05-01T16:30:00Z');
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const HOUR = 3600;
const now = sec(NOW);
const exec = (q: string) => sqlite.exec(q);
const at = (iso: string) => new Date(iso);
const MIN = 60_000;

type Mail = { to: string; model: { subject: string; details: { label: string }[] } };
function outbox(): Mail[] {
	return (
		sqlite.prepare(`select payload from outbox_message order by created_at`).all() as {
			payload: string;
		}[]
	).map((r) => JSON.parse(r.payload));
}
const recipients = () =>
	outbox()
		.map((m) => m.to)
		.sort();

function shift(
	id: string,
	role: string,
	over: {
		createdAt?: number;
		startsAt?: number;
		capacity?: number;
		cancelled?: boolean;
		by?: string;
	} = {}
) {
	const startsAt = over.startsAt ?? now + 48 * HOUR;
	exec(`insert into work_order (id, volunteer_role_id) values ('wo-${id}', '${role}')`);
	exec(`insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity, created_at, cancelled_at, created_by_user_id)
		values ('${id}', 'wo-${id}', ${startsAt}, ${startsAt + 3 * HOUR}, ${over.capacity ?? 2},
			${over.createdAt ?? now - HOUR}, ${over.cancelled ? now : 'null'}, ${over.by ? `'${over.by}'` : 'null'})`);
}

beforeEach(() => {
	for (const t of [
		'outbox_message',
		'reminder_sent',
		'notification',
		'notification_preference',
		'volunteer_signup',
		'volunteer_role_interest',
		'volunteer_shift',
		'work_order',
		'volunteer_role',
		'"user"'
	]) {
		exec(`delete from ${t}`);
	}
	exec(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values
		('ana', 'Ana Lee', 'ana@example.test', 1, ${now}, ${now}),
		('ben', 'Ben Ode', 'ben@example.test', 1, ${now}, ${now}),
		('cy', 'Cy Park', 'cy@example.test', 1, ${now}, ${now})`);
	exec(`insert into volunteer_role (id, name) values ('door', 'Door'), ('bar', 'Bar')`);
	exec(`insert into volunteer_role_interest (id, user_id, volunteer_role_id) values
		('i1', 'ana', 'door'), ('i2', 'ben', 'bar'), ('i3', 'cy', 'door'), ('i4', 'cy', 'bar')`);
});

describe('announceOpenShifts', () => {
	it('emails only the members whose roles the shift is in', async () => {
		shift('s-door', 'door');

		await announceOpenShifts(NOW);

		expect(recipients()).toEqual(['ana@example.test', 'cy@example.test']);
	});

	it('sends one email per member listing every new shift in their roles', async () => {
		shift('s-door', 'door');
		shift('s-bar', 'bar');

		await announceOpenShifts(NOW);

		const toCy = outbox().filter((m) => m.to === 'cy@example.test');
		expect(toCy).toHaveLength(1);
		expect(toCy[0].model.details).toHaveLength(2);
	});

	it('sends nothing before 9am club time, then sends at 9am', async () => {
		shift('s-door', 'door', { createdAt: sec(at('2031-05-01T10:00:00Z')) });

		// 8:59am PDT.
		expect((await announceOpenShifts(at('2031-05-01T15:59:00Z'))).due).toBe(false);
		expect(outbox()).toEqual([]);

		await announceOpenShifts(at('2031-05-01T16:00:00Z'));
		expect(recipients()).toEqual(['ana@example.test', 'cy@example.test']);
	});

	it('sends a day whose 9am passes all missed on the next pass that runs', async () => {
		shift('s-door', 'door', { createdAt: sec(at('2031-05-01T10:00:00Z')) });

		// 2:15pm PDT.
		await announceOpenShifts(at('2031-05-01T21:15:00Z'));

		expect(recipients()).toEqual(['ana@example.test', 'cy@example.test']);
	});

	it('holds a shift opened after the digest for the next day', async () => {
		shift('s-door', 'door');
		await announceOpenShifts(NOW);
		exec(`delete from outbox_message`);

		shift('s-bar', 'bar', { createdAt: now + 5 * 60 });
		const later = await announceOpenShifts(new Date(NOW.getTime() + 15 * MIN));
		expect(later.due).toBe(false);
		expect(outbox()).toEqual([]);

		await announceOpenShifts(new Date(NOW.getTime() + 24 * HOUR * 1000));
		expect(recipients()).toEqual(['ben@example.test', 'cy@example.test']);
		const toCy = outbox().find((m) => m.to === 'cy@example.test')!;
		expect(toCy.model.details).toHaveLength(1);
	});

	it('looks back to the previous digest, however long ago it was', async () => {
		exec(`insert into reminder_sent (id, reminder_key, subject_type, subject_id, sent_at)
			values ('d0', '${SHIFT_DIGEST_KEY}', 'club_day', '2031-04-28', ${now - 72 * HOUR})`);
		shift('s-door', 'door', { createdAt: now - 60 * HOUR });
		shift('s-bar', 'bar', { createdAt: now - 80 * HOUR });

		await announceOpenShifts(NOW);

		expect(recipients()).toEqual(['ana@example.test', 'cy@example.test']);
	});

	it('announces a shift once, however many passes run', async () => {
		shift('s-door', 'door');

		await announceOpenShifts(NOW);
		await announceOpenShifts(new Date(NOW.getTime() + 15 * MIN));
		await announceOpenShifts(new Date(NOW.getTime() + 24 * HOUR * 1000));

		expect(recipients()).toEqual(['ana@example.test', 'cy@example.test']);
	});

	it('stamps a shift nobody is interested in, so it is not asked about again', async () => {
		exec(`insert into volunteer_role (id, name) values ('stage', 'Stage')`);
		shift('s-stage', 'stage');

		expect((await announceOpenShifts(NOW)).shifts).toBe(1);
		expect((await announceOpenShifts(new Date(NOW.getTime() + 24 * HOUR * 1000))).shifts).toBe(0);
	});

	it('respects a member who turned the email off', async () => {
		exec(`insert into notification_preference (id, user_id, notification_type, email_enabled, in_app_enabled, sms_enabled)
			values ('p1', 'ana', '${SHIFT_OPENED_TYPE}', 0, 0, 0)`);
		shift('s-door', 'door');

		await announceOpenShifts(NOW);

		expect(recipients()).toEqual(['cy@example.test']);
	});

	it('skips members already on the shift and whoever created it', async () => {
		shift('s-door', 'door', { by: 'cy' });
		exec(
			`insert into volunteer_signup (id, shift_id, user_id, status) values ('su', 's-door', 'ana', 'invited')`
		);

		await announceOpenShifts(NOW);

		expect(outbox()).toEqual([]);
	});

	it.each([
		['created before the first lookback', { createdAt: now - 25 * HOUR }],
		['already started', { startsAt: now - HOUR }],
		['called off', { cancelled: true }]
	])('leaves out a shift %s', async (_name, over) => {
		shift('s-door', 'door', over);

		await announceOpenShifts(NOW);

		expect(outbox()).toEqual([]);
	});

	it('leaves out a full shift', async () => {
		shift('s-door', 'door', { capacity: 1 });
		exec(
			`insert into volunteer_signup (id, shift_id, user_id, status) values ('su', 's-door', 'ben', 'confirmed')`
		);

		await announceOpenShifts(NOW);

		expect(outbox()).toEqual([]);
	});
});
