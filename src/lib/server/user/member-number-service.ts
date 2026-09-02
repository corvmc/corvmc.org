/**
 * Member numbers — the short, human-sized identifier a member can say out loud.
 *
 * `user.id` is an opaque better-auth string, so `/directory/members/{uuid}` is
 * not an address anyone hands out. `user.memberNumber` and its
 * `user_member_number_unique` index have existed since directory profiles
 * landed, but nothing ever assigned one outside the dev seed: this module is
 * what fills it, from the signup hook and from
 * `scripts/backfill-member-numbers.ts`.
 *
 * Numbers reflect join order and are not treated as sensitive — `/m/{n}` is a
 * public redirect, and the members-panel profile has shown the number as a pill
 * since those profiles shipped.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';

/**
 * How many times `assignMemberNumber` will try.
 *
 * Allocation is `max(member_number) + 1` read outside any transaction, so two
 * signups landing together can pick the same value; the unique index rejects
 * the loser and it re-reads the max. One retry, not a lock — a member number is
 * worth a second query and nothing more.
 */
const MAX_ATTEMPTS = 2;

function isUniqueViolation(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err ?? '');
	return /UNIQUE constraint failed/i.test(message);
}

/** The next free number: one past the highest ever issued, starting at 1. */
async function nextMemberNumber(): Promise<number> {
	const [row] = await db.select({ max: sql<number | null>`max(${user.memberNumber})` }).from(user);
	return (row?.max ?? 0) + 1;
}

/**
 * Give a user a member number if they have none, and return it.
 *
 * Idempotent: a user who already holds a number keeps it, and that number comes
 * back unchanged. `null` means there is no such user — or, vanishingly, that
 * the row was numbered concurrently and still read as unnumbered afterwards.
 * Neither is worth an exception at the two call sites, both of which treat a
 * missing number as costing a tidy URL and nothing else.
 */
export async function assignMemberNumber(userId: string): Promise<number | null> {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const [row] = await db
			.select({ memberNumber: user.memberNumber })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);
		if (!row) return null;
		if (row.memberNumber !== null) return row.memberNumber;

		const next = await nextMemberNumber();

		try {
			// `isNull(memberNumber)` in the predicate, not only in the read above:
			// it is what makes a concurrent assignment to the SAME user a no-op
			// rather than a renumbering. No row back means somebody else got there
			// first, and the next pass reads the number they issued.
			const [updated] = await db
				.update(user)
				.set({ memberNumber: next })
				.where(and(eq(user.id, userId), isNull(user.memberNumber)))
				.returning({ memberNumber: user.memberNumber });
			if (updated) return updated.memberNumber;
		} catch (err) {
			// The last attempt rethrows, so a real failure stays visible: the signup
			// hook reports it to Sentry and the backfill prints it.
			if (attempt === MAX_ATTEMPTS - 1 || !isUniqueViolation(err)) throw err;
		}
	}
	return null;
}

/**
 * The user behind a member number, or null.
 *
 * Soft-deleted accounts are excluded, so a deactivated member's number stops
 * resolving without ever being reissued — the unique index still holds it.
 */
export async function getUserByMemberNumber(
	memberNumber: number
): Promise<{ id: string; name: string } | null> {
	const [row] = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(and(eq(user.memberNumber, memberNumber), isNull(user.deletedAt)))
		.limit(1);
	return row ?? null;
}
