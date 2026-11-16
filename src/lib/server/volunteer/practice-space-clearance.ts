import { db } from '#lib/server/db/index.js';
import { memberCertification } from '#lib/server/db/schema/volunteer.js';
import { group, groupMember } from '#lib/server/db/schema/group.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { sql, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { PRACTICE_SPACE_CLEARANCE_ID } from '#lib/config.js';
import { auditLog } from '#lib/server/db/schema/audit.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';

/**
 * The "Practice space" clearance: the member has been shown around the room.
 * Without a current one, a member's own booking needs the new-member notice
 * (`reservation.newMemberMinAdvanceMinutes`) so someone can be found to run it.
 */

/**
 * A grant of it held at `at`: `wasHeldOn` as SQL. Only `sql` from drizzle-orm,
 * because reservation specs mock that module export by export. `userId` may be
 * a column, which correlates the predicate to an outer query's member.
 */
function heldSql(userId: string | SQLWrapper, at: Date) {
	const ts = Math.floor(at.getTime() / 1000);
	return sql`${memberCertification.userId} = ${userId}
		and ${memberCertification.certificationId} = ${PRACTICE_SPACE_CLEARANCE_ID}
		and ${memberCertification.grantedAt} <= ${ts}
		and (${memberCertification.expiresAt} is null or ${memberCertification.expiresAt} >= ${ts})
		and (${memberCertification.revokedAt} is null or ${memberCertification.revokedAt} > ${ts})`;
}

function holdsPracticeSpaceClearanceSql(userId: SQLWrapper, at: Date) {
	return sql`exists (select 1 from ${memberCertification} where ${heldSql(userId, at)})`;
}

/**
 * Another active member of a live band `userId` is active in holds it at `at`.
 * Raw aliases because `group_member` joins itself; the clearance row reuses
 * `heldSql` on the bandmate.
 */
function throughBandSql(userId: SQLWrapper, at: Date) {
	return sql`exists (select 1 from group_member mine
		join "group" g on g.id = mine.group_id and g.kind = 'band' and g.deleted_at is null
		join group_member mate on mate.group_id = g.id and mate.status = 'active'
			and mate.user_id <> mine.user_id
		join ${memberCertification} on ${heldSql(sql`mate.user_id`, at)}
		where mine.user_id = ${userId} and mine.status = 'active')`;
}

/**
 * Whether the member in `userId` (a column of the outer query) is cleared at
 * `at`: the SQL form of `practiceSpaceClearance`, for list reads.
 */
export function clearedForPracticeSpaceSql(userId: SQLWrapper, at: Date) {
	return sql`(${holdsPracticeSpaceClearanceSql(userId, at)} or ${throughBandSql(userId, at)})`;
}

export async function holdsPracticeSpaceClearance(
	userId: string,
	at: Date = new Date()
): Promise<boolean> {
	const rows = await db
		.select({ id: memberCertification.id })
		.from(memberCertification)
		.where(heldSql(userId, at))
		.limit(1);
	return rows.length > 0;
}

export interface ClearedThroughBand {
	groupId: string;
	groupName: string;
	bandmateUserId: string;
	bandmateName: string;
}

/** The first live band, by name, where another active member holds it at `at`. */
export async function clearedThroughBand(
	userId: string,
	at: Date = new Date()
): Promise<ClearedThroughBand | null> {
	const mine = alias(groupMember, 'mine');
	const mate = alias(groupMember, 'mate');
	const [row] = await db
		.select({
			groupId: group.id,
			groupName: group.name,
			bandmateUserId: mate.userId,
			bandmateName: user.name
		})
		.from(mine)
		.innerJoin(
			group,
			sql`${group.id} = ${mine.groupId} and ${group.kind} = 'band' and ${group.deletedAt} is null`
		)
		.innerJoin(
			mate,
			sql`${mate.groupId} = ${group.id} and ${mate.status} = 'active' and ${mate.userId} <> ${mine.userId}`
		)
		.innerJoin(memberCertification, heldSql(mate.userId, at))
		.innerJoin(user, sql`${user.id} = ${mate.userId}`)
		.where(sql`${mine.userId} = ${userId} and ${mine.status} = 'active'`)
		.orderBy(sql`${group.name}`, sql`${user.name}`)
		.limit(1);
	return row ?? null;
}

/**
 * The one decision on whether a member is cleared for the room (#3028): their
 * own current clearance, or an active place in a live band where another
 * active member holds one. A band path writes no certification row, so it
 * lasts only while the band link does. Null when neither holds.
 */
export async function practiceSpaceClearance(
	userId: string,
	at: Date = new Date()
): Promise<{ via: 'own' } | ({ via: 'band' } & ClearedThroughBand) | null> {
	if (await holdsPracticeSpaceClearance(userId, at)) return { via: 'own' };
	const band = await clearedThroughBand(userId, at);
	return band ? { via: 'band', ...band } : null;
}

/**
 * Record which band and bandmate cleared a booking: warn, record, allow.
 * Once per booking, since a re-delivered `reservation.created` calls it again.
 */
export async function recordClearedThroughBand(
	booking: { reservationId: string; userId: string; userName: string } & Record<
		'date' | 'startTime' | 'endTime',
		string
	>,
	band: ClearedThroughBand
): Promise<void> {
	const [already] = await db
		.select({ id: auditLog.id })
		.from(auditLog)
		.where(
			sql`${auditLog.action} = 'reservation.cleared_through_band'
				and ${auditLog.subjectId} = ${booking.userId}
				and json_extract(${auditLog.details}, '$.reservationId') = ${booking.reservationId}`
		)
		.limit(1);
	if (already) return;
	await recordAuditEntry({
		action: 'reservation.cleared_through_band',
		subject: { type: 'user', id: booking.userId, label: booking.userName || null },
		details: {
			reservationId: booking.reservationId,
			date: booking.date,
			startTime: booking.startTime,
			endTime: booking.endTime,
			groupId: band.groupId,
			groupName: band.groupName,
			bandmateUserId: band.bandmateUserId,
			bandmateName: band.bandmateName
		}
	});
}

/**
 * Append a grant unless a current one exists. Check-then-insert: the shift
 * listener and a staff hand-close racing could both insert, which leaves two
 * current rows and the same answer. Stamped at the instant rather than noon club
 * time, so a morning grant clears the member at once.
 */
export async function grantPracticeSpaceClearance(
	userId: string,
	opts: { grantedByUserId: string | null; notes?: string | null }
): Promise<void> {
	const now = new Date();
	if (await holdsPracticeSpaceClearance(userId, now)) return;
	await db.insert(memberCertification).values({
		userId,
		certificationId: PRACTICE_SPACE_CLEARANCE_ID,
		grantedAt: now,
		grantedByUserId: opts.grantedByUserId,
		notes: opts.notes?.trim() || null
	});
}
