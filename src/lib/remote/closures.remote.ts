import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { db } from '$lib/server/db';
import { closure } from '$lib/server/db/schema/reservation';
import { asc, desc, eq, gte, lt } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Upcoming closures soonest-first, then past ones newest-first.
 *
 * One `desc(startsAt)` put the most *distant* future closure at the top and
 * buried the imminent one under it; past rows then trailed off with nothing
 * saying where now was (#1053). The past side is capped — the page is for
 * arranging what is coming, and the archive grows forever.
 */
const PAST_CLOSURES_SHOWN = 20;

export const getClosures = query(z.void(), async () => {
	await requireCapability('reservation.read');
	const now = new Date();

	const [upcoming, past] = await Promise.all([
		db
			.select()
			.from(closure)
			.where(gte(closure.endsAt, now))
			.orderBy(asc(closure.startsAt), asc(closure.id)),
		db
			.select()
			.from(closure)
			.where(lt(closure.endsAt, now))
			.orderBy(desc(closure.startsAt), desc(closure.id))
			.limit(PAST_CLOSURES_SHOWN + 1)
	]);

	const shape = (c: typeof closure.$inferSelect) => ({
		id: c.id,
		reason: c.reason,
		startsAt: c.startsAt,
		endsAt: c.endsAt
	});

	return {
		upcoming: upcoming.map(shape),
		past: past.slice(0, PAST_CLOSURES_SHOWN).map(shape),
		/** True when the archive is longer than what is shown. */
		morePast: past.length > PAST_CLOSURES_SHOWN
	};
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const createClosure = form(
	z.object({
		reason: z.string().min(1).max(255),
		startsAt: z.string(),
		endsAt: z.string()
	}),
	async (data, issue) => {
		await requireCapability('reservation.manageClosures');

		const startsAt = new Date(data.startsAt as string);
		const endsAt = new Date(data.endsAt as string);

		if (endsAt <= startsAt) {
			invalid(issue.endsAt('End time must be after start time'));
		}

		await db.insert(closure).values({ reason: data.reason as string, startsAt, endsAt });

		void getClosures().refresh();
		return { success: true };
	}
);

export const updateClosure = form(
	z.object({
		id: z.string(),
		reason: z.string().min(1).max(255),
		startsAt: z.string(),
		endsAt: z.string()
	}),
	async (data) => {
		await requireCapability('reservation.manageClosures');

		const id = data.id as string;
		const startsAt = new Date(data.startsAt as string);
		const endsAt = new Date(data.endsAt as string);

		const [row] = await db
			.select({ startsAt: closure.startsAt })
			.from(closure)
			.where(eq(closure.id, id))
			.limit(1);

		if (!row) throw error(404, 'Closure not found');
		if (row.startsAt <= new Date()) throw error(400, 'Cannot edit a past or active closure');
		if (endsAt <= startsAt) throw error(400, 'End time must be after start time');

		await db
			.update(closure)
			.set({ reason: data.reason as string, startsAt, endsAt })
			.where(eq(closure.id, id));

		void getClosures().refresh();
		return { success: true };
	}
);

export const deleteClosure = form(
	z.object({
		id: z.string()
	}),
	async (data) => {
		await requireCapability('reservation.manageClosures');

		const id = data.id as string;

		const [row] = await db
			.select({ startsAt: closure.startsAt })
			.from(closure)
			.where(eq(closure.id, id))
			.limit(1);

		if (!row) throw error(404, 'Closure not found');
		if (row.startsAt <= new Date()) throw error(400, 'Cannot delete a past or active closure');

		await db.delete(closure).where(eq(closure.id, id));

		void getClosures().refresh();
		return { success: true };
	}
);
