import { describe, it, expect, vi, beforeEach } from 'vitest';

// A suspension end to end against a real SQLite: the term scopes which
// bookings are cancelled, the record carries the term, sign-in names the
// suspension, and the lapse job gives the account back once, not twice.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/audit/audit-service.js', () => ({ recordAuditEntry: vi.fn() }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: vi.fn(async () => 90)
}));
const cancelled: string[] = [];
vi.mock('#lib/server/reservation/reservation-service.js', () => ({
	cancel: vi.fn(async (id: string) => {
		cancelled.push(id);
	})
}));
const billing = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('#lib/server/finance/subscription-service.js', () => ({
	cancel: vi.fn(async () => billing.calls.push('cancel')),
	pause: vi.fn(async () => billing.calls.push('pause')),
	unpause: vi.fn(async () => billing.calls.push('unpause')),
	resume: vi.fn(async () => billing.calls.push('resume')),
	getSubscription: vi.fn(async () => ({ cancelAtPeriodEnd: false }))
}));
vi.mock('#lib/server/lock/member-code-service.js', () => ({ revokeMemberCode: vi.fn() }));
vi.mock('#lib/server/auth-emails.js', async (original) => ({
	...(await original<typeof import('#lib/server/auth-emails.js')>()),
	sendAccountSuspendedEmail: vi.fn(),
	sendAccountRestoredEmail: vi.fn()
}));

const {
	suspendUser,
	liftLapsedSuspensions,
	reactivateUser,
	UserSuspendedError,
	SuspensionTermError
} = await import('./user-service');
const { signInRefusal } = await import('#lib/server/auth.js');

const DAY = 86_400_000;

function seed() {
	sqlite.exec(`
		insert into user (id, name, email, email_verified, stripe_id, created_at, updated_at)
			values ('m1', 'Member', 'm1@example.com', 1, 'cus_1', 0, 0),
			       ('staff', 'Staffer', 'staff@example.com', 1, null, 0, 0);
		insert into session (id, user_id, token, expires_at, created_at, updated_at)
			values ('s1', 'm1', 'tok', 9999999999, 0, 0);
	`);
	const at = (days: number) => Math.floor((Date.now() + days * DAY) / 1000);
	const insert = sqlite.prepare(
		`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
		 values (?, 'user', 'm1', 'm1', 'confirmed', ?, ?)`
	);
	insert.run('in-term', at(3), at(3) + 3600);
	insert.run('after-term', at(20), at(20) + 3600);
}

const row = () =>
	sqlite.prepare(`select deleted_at as deletedAt from user where id = 'm1'`).get() as {
		deletedAt: number | null;
	};
const removal = () =>
	sqlite
		.prepare(`select kind, ends_at, lifted_at, lift_reason, ledger from account_removal`)
		.get() as Record<string, unknown> | undefined;

beforeEach(() => {
	sqlite.exec(
		'delete from account_removal; delete from content_flag; delete from reservation; delete from session; delete from user;'
	);
	cancelled.length = 0;
	billing.calls = [];
	seed();
});

describe('suspendUser', () => {
	it('cancels only bookings in the term, pauses billing and records the term', async () => {
		const { endsAt } = await suspendUser('m1', { actorId: 'staff', reason: 'Fight', days: 10 });

		expect(cancelled).toEqual(['in-term']);
		expect(billing.calls).toEqual(['pause']);
		expect(row().deletedAt).not.toBeNull();
		expect(sqlite.prepare(`select count(*) as n from session`).get()).toEqual({ n: 0 });
		expect(removal()).toMatchObject({
			kind: 'suspension',
			ends_at: Math.floor(endsAt.getTime() / 1000),
			lifted_at: null
		});
		expect(JSON.parse(removal()!.ledger as string)).toMatchObject({ billing: 'paused' });
	});

	it('refuses a term outside the configured range', async () => {
		await expect(
			suspendUser('m1', { actorId: 'staff', reason: 'x', days: 91 })
		).rejects.toBeInstanceOf(SuspensionTermError);
		await expect(
			suspendUser('m1', { actorId: 'staff', reason: 'x', days: 0 })
		).rejects.toBeInstanceOf(SuspensionTermError);
	});

	it('names the suspension at sign-in once the password matches', async () => {
		await suspendUser('m1', { actorId: 'staff', reason: 'x', days: 10 });
		const open = sqlite
			.prepare(`select id from account_removal where user_id = 'm1' and lifted_at is null`)
			.get() as { id: string };
		const signInRow = { deletedAt: new Date(), bannedAt: null, removalId: open.id };
		expect(await signInRefusal(signInRow, async () => true)).toBe('suspended');
		expect(await signInRefusal(signInRow, async () => false)).toBe('invalid');
	});

	it('is not undone by a plain reactivation', async () => {
		await suspendUser('m1', { actorId: 'staff', reason: 'x', days: 10 });
		await expect(reactivateUser('m1')).rejects.toBeInstanceOf(UserSuspendedError);
		expect(row().deletedAt).not.toBeNull();
	});
});

describe('liftLapsedSuspensions', () => {
	it('leaves a suspension alone until its term ends', async () => {
		await suspendUser('m1', { actorId: 'staff', reason: 'x', days: 10 });
		await expect(liftLapsedSuspensions(new Date(Date.now() + 9 * DAY))).resolves.toEqual({
			due: 0,
			lifted: 0
		});
		expect(row().deletedAt).not.toBeNull();
	});

	it('restores the account and resumes billing once, then finds nothing', async () => {
		await suspendUser('m1', { actorId: 'staff', reason: 'x', days: 10 });
		const later = new Date(Date.now() + 11 * DAY);

		await expect(liftLapsedSuspensions(later)).resolves.toEqual({ due: 1, lifted: 1 });
		expect(row().deletedAt).toBeNull();
		expect(removal()).toMatchObject({ lift_reason: 'term_lapsed' });
		expect(billing.calls).toEqual(['pause', 'unpause']);

		await expect(liftLapsedSuspensions(later)).resolves.toEqual({ due: 0, lifted: 0 });
	});
});
