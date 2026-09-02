import { db } from '$lib/server/db';
import { inboxSavedView } from '$lib/server/db/schema/inbox';
import { and, asc, eq } from 'drizzle-orm';

/**
 * Saved queue views, one person's at a time.
 *
 * Every function here takes the owner's id and constrains on it, rather than
 * trusting a view id to belong to whoever sent it — a saved view is not secret,
 * but renaming or deleting someone else's is still not on offer.
 */

export interface SavedViewFilters {
	view?: string;
	channel?: string;
	assigned?: string;
	subject?: string;
	waitingDays?: number;
	q?: string;
}

export async function listSavedViews(userId: string) {
	return (
		db
			.select({
				id: inboxSavedView.id,
				name: inboxSavedView.name,
				filters: inboxSavedView.filters,
				createdAt: inboxSavedView.createdAt
			})
			.from(inboxSavedView)
			.where(eq(inboxSavedView.userId, userId))
			// Oldest first, so the tabs do not reshuffle every time one is added.
			.orderBy(asc(inboxSavedView.createdAt))
	);
}

export async function createSavedView(userId: string, name: string, filters: SavedViewFilters) {
	const [row] = await db
		.insert(inboxSavedView)
		.values({ userId, name, filters })
		// Saving over a name is a rename of what that tab means, not a duplicate.
		// The unique index is on (user, name), so this is the whole conflict.
		.onConflictDoUpdate({
			target: [inboxSavedView.userId, inboxSavedView.name],
			set: { filters }
		})
		.returning({ id: inboxSavedView.id });

	return row;
}

export async function deleteSavedView(userId: string, id: string) {
	await db
		.delete(inboxSavedView)
		.where(and(eq(inboxSavedView.id, id), eq(inboxSavedView.userId, userId)));
}
