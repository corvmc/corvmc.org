import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { db } from '$lib/server/db';
import { closure } from '$lib/server/db/schema/reservation';
import { eq } from 'drizzle-orm';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

// The list is the staff reservations page (#1833); its actions invalidate it.

/** A datetime-local value carries no zone; it is club time, not the runtime's. */
function clubDateTime(value: string): Date {
	const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
	return m ? buildDateInTz(m[1], m[2], DEFAULT_TIMEZONE) : new Date(value);
}

export const createClosure = form(
	z.object({
		reason: z.string().min(1).max(255),
		startsAt: z.string(),
		endsAt: z.string()
	}),
	async (data, issue) => {
		await requireCapability('reservation.manageClosures');

		const startsAt = clubDateTime(data.startsAt as string);
		const endsAt = clubDateTime(data.endsAt as string);

		if (endsAt <= startsAt) {
			invalid(issue.endsAt('End time must be after start time'));
		}
		// A closure that is already over blocks nothing and never lists as upcoming;
		// it is almost always AM picked for PM.
		if (endsAt <= new Date()) {
			invalid(issue.endsAt('That time has already passed'));
		}

		await db.insert(closure).values({ reason: data.reason as string, startsAt, endsAt });

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
		const startsAt = clubDateTime(data.startsAt as string);
		const endsAt = clubDateTime(data.endsAt as string);

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

		return { success: true };
	}
);
