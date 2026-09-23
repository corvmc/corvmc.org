import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { getStandings, restoreStanding } from '$lib/server/moderation/standing-service';
import { standingScopes } from '$lib/config';

// Staff-side standing, for every scope at once.
//
// This replaces a per-domain query and a per-domain restore form for each of
// community listings, suggestions and messaging — six near-identical remotes
// whose only difference was which table they named. The member-facing reads
// stay in their own domain remotes, because a member only ever asks about one
// scope; it is staff who need the whole picture in one round trip.

/** Every scope for one member, for the staff user detail page. One query, not three. */
export const getMemberStandings = query(z.string(), async (userId) => {
	await requireCapability('moderation.setStanding');
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
		const staff = await requireCapability('moderation.setStanding');
		await restoreStanding({ userId: data.userId, scope: data.scope, staffId: staff.id });
		void getMemberStandings(data.userId).refresh();
		return { success: true };
	}
);
