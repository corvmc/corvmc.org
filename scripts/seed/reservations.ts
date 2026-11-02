import { user } from '../../src/lib/server/db/schema/authentication';
import {
	closure,
	reservation,
	lockFallbackCode,
	lockMemberCode,
	accessHolding
} from '../../src/lib/server/db/schema/reservation';
import { db } from './db';
import { CLOSURE_REASONS } from './pools';
import { HOURLY_RATE_CENTS, type SeedReservation, type SeedUser } from './types';
import { claimRoomNear, holdRoom } from './room';
import { pick, ptDate, random, randomInt } from './util';
import { randomUUID } from 'crypto';
import { DOOR_CODE_POOL_SIZE } from '../../src/lib/config';

/** A slot for a row of this status: cancelled ones take the time they asked for. */
function bookRoom(startsAt: Date, durationHours: number, status: string) {
	if (status === 'cancelled' || status === 'waitlisted') {
		return { startsAt, endsAt: new Date(startsAt.getTime() + durationHours * 3_600_000) };
	}
	return claimRoomNear(startsAt, durationHours);
}

export async function seedReservations(users: SeedUser[]): Promise<SeedReservation[]> {
	console.log('Seeding reservations...');
	const rows: SeedReservation[] = [];

	for (let day = -14; day < 0; day++) {
		const count = randomInt(1, 4);
		let hour = randomInt(9, 14);
		for (let i = 0; i < count; i++) {
			const duration = pick([1, 1.5, 2]);
			hour += duration + 0.5;
			if (hour > 21) break;

			const status = random() > 0.15 ? 'completed' : pick(['no_show', 'cancelled']);
			// The room is one room and eight seeders book it. A cancelled row is
			// exempt: `hasConflict` ignores those, so holding the room for one
			// would make the seed stricter than the rule it is modelling.
			const slot = bookRoom(ptDate(day, hour - duration - 0.5), duration, status);
			if (!slot) continue;
			const { startsAt, endsAt } = slot;
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
					cancelledBy: status === 'cancelled' ? 'member' : null,
					cancelledByUserId: status === 'cancelled' ? member.id : null,
					cancelledAt: status === 'cancelled' ? new Date(startsAt.getTime() - 86_400_000) : null,
					creditsUsed,
					cashDueCents,
					// A fully covered booking is settled by the credits themselves —
					// leaving `paidAt` null is what marks it "Paid with credits"
					// rather than "Paid".
					// A booking settled by credits or comped away was never *paid* —
					// leaving `paidAt` null is what distinguishes those states.
					paidAt: status === 'completed' && cashDueCents !== 0 ? startsAt : null,
					// Only `reservation/checkout-listener.ts` writes this in the running
					// app, off the webhook — so without seeding it, no "paid online"
					// reservation exists locally and every surface that keys on it
					// renders as if nobody has ever paid for a room.
					stripePaymentRecordId:
						status === 'completed' && cashDueCents !== 0
							? `pr_seed_${randomUUID().replace(/-/g, '').slice(0, 16)}`
							: null
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
			hour += duration + 0.5;
			if (hour > 21) break;

			const status = day === 0 ? 'confirmed' : pick(['scheduled', 'confirmed']);
			const slot = bookRoom(ptDate(day, hour - duration - 0.5), duration, status);
			if (!slot) continue;
			const { startsAt, endsAt } = slot;
			const member = pick(users);

			// Confirmed bookings inside the provisioning window carry a door code,
			// mirroring the daily lock job. Both sync states must be reachable
			// locally: `lockSyncedAt` set is the code the member sees, null is the
			// one queued in U-tec's cloud that shows as pending, with the break-glass
			// code standing in. Today's first booking is left unconfirmed so that
			// path is not visible only in production.
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

	// A named booking a walkthrough is pointed at, so it takes the room rather
	// than asking for it — `findRoomConflicts` is what says if that hurt.
	const newcomerSlot = holdRoom(ptDate(2, 18), ptDate(2, 20), 'newcomer');

	const [firstEver] = await db
		.insert(reservation)
		.values({
			bookerType: 'user',
			bookerId: newcomer.id,
			createdByUserId: newcomer.id,
			status: 'scheduled',
			...newcomerSlot,
			notes: 'First time here — is there somewhere to park a van?'
		})
		.returning();
	rows.push(firstEver);

	rows.push(...(await seedCancellationKinds(users)));

	return rows;
}

/**
 * One cancelled booking per way a booking gets cancelled, so the staff detail
 * page's "Cancelled by …" line can be seen for each. Fixed rather than rolled:
 * the loops above only sometimes cancel, and always as the member. A cancelled
 * row holds no room, so these need no slot.
 */
async function seedCancellationKinds(users: SeedUser[]): Promise<SeedReservation[]> {
	const [staff, member] = users;
	const kinds = [
		{ cancelledBy: 'member', byUserId: member.id, reason: 'Drummer is sick' },
		{ cancelledBy: 'staff', byUserId: staff.id, reason: null },
		{ cancelledBy: 'owner', byUserId: member.id, reason: 'Band deleted' },
		{ cancelledBy: 'system', byUserId: null, reason: 'Not confirmed before start' },
		{ cancelledBy: 'system', byUserId: null, reason: 'Waitlist expired' },
		// A row from before anyone recorded who cancelled.
		{ cancelledBy: null, byUserId: null, reason: null }
	] as const;
	return db
		.insert(reservation)
		.values(
			kinds.map((k, i) => ({
				bookerType: 'user' as const,
				bookerId: member.id,
				createdByUserId: member.id,
				status: 'cancelled' as const,
				startsAt: ptDate(-3 + i, 10),
				endsAt: ptDate(-3 + i, 12),
				cancellationReason: k.reason,
				cancelledBy: k.cancelledBy,
				cancelledByUserId: k.byUserId,
				cancelledAt: k.cancelledBy ? ptDate(-5 + i, 16) : null
			}))
		)
		.returning();
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
 * The door-access rows that are not per-reservation: the door-code pool
 * (#2120), and a few standing member codes.
 *
 * Without these the staff surfaces render empty and the member fallback path
 * is unreachable locally — which is how the whole integration came to be built
 * against states nobody had ever seen.
 */
export async function seedLockAccess(users: SeedUser[], reservations: SeedReservation[] = []) {
	console.log('Seeding lock access...');

	const lockId = () => String(randomInt(100000, 999999));
	const code = () => String(randomInt(10000000, 99999999));
	const confirmed = reservations.filter((r) => r.status === 'confirmed');
	const past = confirmed.find((r) => r.endsAt.getTime() < Date.now() - 3_600_000);
	const upcoming = confirmed.find((r) => r.startsAt.getTime() > Date.now());

	await db.insert(lockFallbackCode).values([
		// Ready on the lock: one short of depth, so a local job run mints one.
		...Array.from({ length: DOOR_CODE_POOL_SIZE - 1 }, (_, i) => ({
			code: code(),
			pooled: true,
			lockAccessId: lockId(),
			syncedAt: ptDate(-5 + (i % 3), 9)
		}))
	]);
	// Two inserts: D1 caps one statement at 100 bound parameters.
	await db.insert(lockFallbackCode).values([
		// Minted during an outage: not confirmed on the lock yet.
		{ code: code(), pooled: true, lockAccessId: lockId() },
		// The break-glass code from before the pool: burned once the pool has stock.
		{ code: code(), lockAccessId: lockId(), syncedAt: ptDate(-40, 9) },
		// Shown at the door for a booking that is over: awaiting removal.
		...(past
			? [
					{
						code: code(),
						pooled: true,
						lockAccessId: lockId(),
						syncedAt: ptDate(-20, 9),
						claimedByReservationId: past.id,
						claimedAt: past.startsAt,
						revealedAt: past.startsAt
					}
				]
			: []),
		// Claimed by an upcoming booking whose page has been opened, not revealed.
		...(upcoming
			? [
					{
						code: code(),
						pooled: true,
						lockAccessId: lockId(),
						syncedAt: ptDate(-20, 9),
						claimedByReservationId: upcoming.id,
						claimedAt: ptDate(0, 9)
					}
				]
			: [])
	]);

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

	// The key holder register: two keys out, an alarm code held by somebody with
	// no account, and one key back — so both tabs have rows.
	const [, , , keyHolder, keyReturner] = users;
	await db.insert(accessHolding).values([
		{
			kind: 'key',
			label: 'Front door key 1',
			holderUserId: holder.id,
			holderName: holder.name,
			issuedAt: ptDate(-400, 12),
			issuedByUserId: holder.id
		},
		{
			kind: 'alarm_code',
			label: 'Alarm user 4',
			holderName: 'Landlord',
			issuedAt: ptDate(-700, 12),
			issuedByUserId: holder.id,
			notes: 'Building owner — needs it for inspections'
		},
		...(keyHolder
			? [
					{
						kind: 'key' as const,
						label: 'Front door key 2',
						holderUserId: keyHolder.id,
						holderName: keyHolder.name,
						issuedAt: ptDate(-120, 12),
						issuedByUserId: holder.id
					}
				]
			: []),
		...(keyReturner
			? [
					{
						kind: 'key' as const,
						label: 'Back door key 1',
						holderUserId: keyReturner.id,
						holderName: keyReturner.name,
						issuedAt: ptDate(-300, 12),
						issuedByUserId: holder.id,
						returnedAt: ptDate(-30, 12),
						returnedByUserId: holder.id,
						returnNotes: 'Stepped back from the board'
					}
				]
			: [])
	]);
}
