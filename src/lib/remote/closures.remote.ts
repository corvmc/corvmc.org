import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import { db } from '$lib/server/db';
import { closure } from '$lib/server/db/schema/reservation';
import { desc, eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getClosures = query(z.void(), async () => {
	await requireCapability('reservation.read');
	const rows = await db.select().from(closure).orderBy(desc(closure.startsAt));

	return rows.map((c) => ({
		id: c.id,
		reason: c.reason,
		startsAt: c.startsAt,
		endsAt: c.endsAt
	}));
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
