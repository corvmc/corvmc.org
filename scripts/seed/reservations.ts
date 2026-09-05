import { user } from '../../src/lib/server/db/schema/authentication';
import {
	closure,
	reservation,
	lockFallbackCode,
	lockMemberCode
} from '../../src/lib/server/db/schema/reservation';
import { db } from './db';
import { CLOSURE_REASONS } from './pools';
import { HOURLY_RATE_CENTS, type SeedReservation, type SeedUser } from './types';
import { pick, ptDate, random, randomInt } from './util';
import { randomUUID } from 'crypto';

export async function seedReservations(users: SeedUser[]): Promise<SeedReservation[]> {
	console.log('Seeding reservations...');
	const rows: SeedReservation[] = [];

	for (let day = -14; day < 0; day++) {
		const count = randomInt(1, 4);
		let hour = randomInt(9, 14);
		for (let i = 0; i < count; i++) {
			const duration = pick([1, 1.5, 2]);
			const startsAt = ptDate(day, hour);
			const endsAt = ptDate(day, hour + duration);
			hour += duration + 0.5;
			if (hour > 21) break;

			const status = random() > 0.15 ? 'completed' : pick(['no_show', 'cancelled']);
			const member = pick(users);

			// Free-hour settlement, mirroring `commitReservationCredits`:
			// `creditsUsed` is denominated in hours and `cashDueCents` freezes the
			// remainder owed at the door. Cancelled and no-show bookings keep both
			// null, the way cancellation resets them.
			//
			// Without this every seeded reservation settled in cash, so the staff
			// Payment column rendered nothing but plain dollar amounts and the
			// credit-covered and mixed shapes went unexercised locally.
			const coverage =
				status === 'completed' ? pick(['none', 'none', 'partial', 'full', 'comped']) : 'none';
			// Measured off the stored timestamps, not `duration`: `ptDate` floors a
			// fractional hour (setUTCHours truncates), and the `hour` accumulator
			// goes fractional, so the booking on disk is regularly longer than the
			// duration picked for it. Deriving from `duration` wrote credits that
			// overran their own reservation.
			const bookedHours = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60);
			const creditsUsed =
				coverage === 'full'
					? bookedHours
					: coverage === 'partial'
						? Math.min(0.5, bookedHours)
						: null;
			// Comped waives the charge outright: nothing owed and no credits spent.
			// That tuple — cashDueCents 0 with creditsUsed null — is the only thing
			// separating a comped booking from a credit-settled one.
			const cashDueCents =
				coverage === 'comped'
					? 0
					: creditsUsed === null
						? null
						: Math.round((bookedHours - creditsUsed) * HOURLY_RATE_CENTS);

			const [r] = await db
				.insert(reservation)
				.values({
					bookerType: 'user',
					bookerId: member.id,
					createdByUserId: member.id,
					status,
					startsAt,
					endsAt,
					notes: random() > 0.7 ? 'Band practice' : null,
					cancellationReason: status === 'cancelled' ? 'Schedule conflict' : null,
					creditsUsed,
					cashDueCents,
					// A fully covered booking is settled by the credits themselves —
					// leaving `paidAt` null is what marks it "Paid with credits"
					// rather than "Paid".
					// A booking settled by credits or comped away was never *paid* —
					// leaving `paidAt` null is what distinguishes those states.
					paidAt: status === 'completed' && cashDueCents !== 0 ? startsAt : null
				})
				.returning();
			rows.push(r);
		}
	}

	for (let day = 0; day <= 14; day++) {
		const count = randomInt(1, 3);
		let hour = randomInt(10, 15);
		for (let i = 0; i < count; i++) {
			const duration = pick([1, 1.5, 2]);
			const startsAt = ptDate(day, hour);
			const endsAt = ptDate(day, hour + duration);
			hour += duration + 0.5;
			if (hour > 21) break;

			const status = day === 0 ? 'confirmed' : pick(['scheduled', 'confirmed']);
			const member = pick(users);

			// Confirmed bookings inside the provisioning window carry a door code,
			// mirroring the daily lock job.
			//
			// Whether the lock has *confirmed* it is the interesting part, and both
			// states have to be reachable locally: `lockSyncedAt` set is the code the
			// member sees, null is the code that is queued in U-tec's cloud and shows
			// as pending — with the break-glass code standing in once they are inside
			// their window. Today's first booking is deliberately left unconfirmed so
			// that path is not something you can only see in production.
			const withinWindow = day >= 0 && day <= 2 && status === 'confirmed';
			const lockCode = withinWindow ? String(randomInt(1000, 9999)) : null;
			const lockAccessId = withinWindow ? String(randomInt(100000, 999999)) : null;
			const lockSyncedAt = withinWindow && !(day === 0 && i === 0) ? new Date() : null;

			const [r] = await db
				.insert(reservation)
				.values({
					bookerType: 'user',
					bookerId: member.id,
					createdByUserId: member.id,
					status,
					startsAt,
					endsAt,
					lockCode,
					lockAccessId,
					lockSyncedAt,
					notes:
						random() > 0.6
							? pick(['Drum practice', 'Guitar lesson prep', 'Recording session'])
							: null
				})
				.returning();
			rows.push(r);
		}
	}

	// A guaranteed first-timer, for the flag the staff list shows so the desk can
	// put a volunteer on the hour. Both loops above pick their member at random,
	// so whether anybody was booking for the first time came down to the dice —
	// and picking one of `users` would not have settled it either, since bands
	// and recurring series seed reservations for those same members afterwards.
	// This member exists only here and books once, with a note, so both of the
	// list's flags are on screen after every seed.
	const newcomerId = randomUUID();
	const [newcomer] = await db
		.insert(user)
		.values({
			id: newcomerId,
			name: 'Wren Okafor',
			email: 'wren.okafor@example.com',
			emailVerified: true,
			pronouns: 'they/them',
			phone: '541-555-0142',
			memberNumber: 999,
			createdAt: new Date(Date.now() - 2 * 86400000),
			updatedAt: new Date()
		})
		.returning();

	const [firstEver] = await db
		.insert(reservation)
		.values({
			bookerType: 'user',
			bookerId: newcomer.id,
			createdByUserId: newcomer.id,
			status: 'scheduled',
			startsAt: ptDate(2, 18),
			endsAt: ptDate(2, 20),
			notes: 'First time here — is there somewhere to park a van?'
		})
		.returning();
	rows.push(firstEver);

	return rows;
}

export async function seedClosures() {
	console.log('Seeding closures...');
	await db.insert(closure).values([
		{ reason: 'Holiday closure — New Year', startsAt: ptDate(-30, 0), endsAt: ptDate(-29, 23, 59) },
		{
			reason: 'Building maintenance — HVAC replacement',
			startsAt: ptDate(21, 8),
			endsAt: ptDate(22, 18)
		},
		{ reason: pick(CLOSURE_REASONS), startsAt: ptDate(35, 0), endsAt: ptDate(35, 23, 59) }
	]);
}

/**
 * The door-access rows that are not per-reservation: the break-glass code, and
 * a few standing member codes.
 *
 * Without these the staff surfaces render empty and the member break-glass path
 * is unreachable locally — which is how the whole integration came to be built
 * against states nobody had ever seen.
 */
export async function seedLockAccess(users: SeedUser[]) {
	console.log('Seeding lock access...');

	// One active break-glass code, confirmed on the lock a while back — which is
	// the point of it: it predates any current outage.
	await db.insert(lockFallbackCode).values({
		code: String(randomInt(10000000, 99999999)),
		lockAccessId: String(randomInt(100000, 999999)),
		syncedAt: ptDate(-12, 9)
	});

	const [holder, lapsed, pending] = users;
	if (!holder) return;

	await db.insert(lockMemberCode).values([
		// A member with a standing code: provisioning skips them entirely.
		{
			userId: holder.id,
			lockAccessId: String(randomInt(100000, 999999)),
			code: String(randomInt(10000000, 99999999)),
			label: holder.name,
			syncedAt: ptDate(-40, 10)
		},
		// Adopted from the lock with no member matched yet — staff still have to
		// work out whose it is.
		{
			lockAccessId: String(randomInt(100000, 999999)),
			code: String(randomInt(100000, 999999)),
			label: 'Trevor',
			adoptedAt: ptDate(-3, 14),
			syncedAt: ptDate(-3, 14)
		},
		// Revoked, so the history is not empty.
		...(lapsed
			? [
					{
						userId: lapsed.id,
						lockAccessId: String(randomInt(100000, 999999)),
						code: String(randomInt(10000000, 99999999)),
						label: lapsed.name,
						syncedAt: ptDate(-90, 10),
						revokedAt: ptDate(-5, 11),
						revokedReason: 'Membership lapsed'
					}
				]
			: []),
		// Granted but not yet on the lock — the queued state.
		...(pending
			? [
					{
						userId: pending.id,
						lockAccessId: String(randomInt(100000, 999999)),
						code: String(randomInt(10000000, 99999999)),
						label: pending.name
					}
				]
			: [])
	]);
}
