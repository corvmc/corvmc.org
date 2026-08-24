import { z } from 'zod';
import { query, form } from '$app/server';
import { requireStaff } from '$lib/server/authorization';
import {
	getStandings,
	setStanding,
	restoreStanding
} from '$lib/server/moderation/standing-service';
import { standingScopes, standingStatuses, STANDING_REASON_MAX } from '$lib/config';

// Staff-side standing, for every scope at once.
//
// This replaces a per-domain query and a per-domain restore form for each of
// community listings, suggestions and messaging — six near-identical remotes
// whose only difference was which table they named. The member-facing reads
// stay in their own domain remotes, because a member only ever asks about one
// scope; it is staff who need the whole picture in one round trip.

/** Every scope for one member, for the staff user detail page. One query, not three. */
export const getMemberStandings = query(z.string(), async (userId) => {
	await requireStaff();
	return getStandings(userId);
});

/**
 * Give a member their standing back in one scope.
 *
 * Scoped, not global: forgiving a suggestion post says nothing about a gig
 * listing, and staff clicking "restore" on one card must not quietly clear the
 * other. Restoring someone who was never restricted is a no-op.
 */
export const restoreMemberStanding = form(
	z.object({ userId: z.string().min(1), scope: z.enum(standingScopes) }),
	async (data) => {
		const staff = await requireStaff();
		await restoreStanding({ userId: data.userId, scope: data.scope, staffId: staff.id });
		void getMemberStandings(data.userId).refresh();
		return { success: true };
	}
);

/**
 * Staff imposing a standing directly, without a report behind it — today that
 * is switching messaging off for the occasional under-18 member, since the site
 * has no age of its own.
 *
 * `setStanding` rejects a status the scope has no meaning for, so this cannot be
 * used to put someone in a state no reader understands.
 */
export const setMemberStanding = form(
	z.object({
		userId: z.string().min(1),
		scope: z.enum(standingScopes),
		status: z.enum(standingStatuses),
		reason: z.string().trim().max(STANDING_REASON_MAX).optional()
	}),
	async (data) => {
		const staff = await requireStaff();
		await setStanding({
			userId: data.userId,
			scope: data.scope,
			status: data.status,
			reason: data.reason || null,
			staffId: staff.id
		});
		void getMemberStandings(data.userId).refresh();
		return { success: true };
	}
);
