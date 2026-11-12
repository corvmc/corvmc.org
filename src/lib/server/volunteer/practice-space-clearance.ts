import { db } from '#lib/server/db/index.js';
import { memberCertification } from '#lib/server/db/schema/volunteer.js';
import { sql, type SQLWrapper } from 'drizzle-orm';
import { PRACTICE_SPACE_CLEARANCE_ID } from '#lib/config.js';

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

/** True when the member in `userId` (a column of the outer query) holds it at `at`. */
export function holdsPracticeSpaceClearanceSql(userId: SQLWrapper, at: Date) {
	return sql`exists (select 1 from ${memberCertification} where ${heldSql(userId, at)})`;
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
