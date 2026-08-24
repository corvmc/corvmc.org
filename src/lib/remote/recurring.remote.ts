import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireStaff, requireStaffOrOwner } from '$lib/server/authorization';
import {
	get,
	getHistory,
	cancel,
	listAll as listAllSeries
} from '$lib/server/reservation/recurring-series-service';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getSeries = query(z.string(), async (id) => {
	await requireStaff();
	const series = await get(id);
	if (!series) error(404, 'Series not found');
	return series;
});

export const getSeriesHistory = query(z.string(), async (id) => {
	await requireStaff();
	return getHistory(id);
});

const staffRecurringFilters = z.object({
	filter: z.string().optional(),
	page: z.number().optional()
});

export const getStaffRecurring = query(staffRecurringFilters, async (filters) => {
	await requireStaff();
	return listAllSeries(
		{ filter: filters.filter || 'active' },
		{ page: filters.page ?? 1, pageSize: 50 }
	);
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/** Cancel from staff list page (takes seriesId in form data) */
export const cancelStaffSeries = form(z.object({ seriesId: z.string() }), async (data) => {
	await requireStaff();
	await cancel(data.seriesId as string);
	return { success: true };
});

/** Cancel from detail page (takes seriesId in form data) */
export const cancelDetailSeries = form(z.object({ seriesId: z.string() }), async (data) => {
	await requireStaff();
	const seriesId = data.seriesId as string;
	await cancel(seriesId);
	void getSeries(seriesId).refresh();
	return { success: true };
});

/** Cancel from member page / CancelSeriesAction (owner or staff) */
export const cancelRecurringSeries = form(z.object({ id: z.string() }), async (data) => {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = data.id as string;
	const series = await get(id);
	if (!series) throw error(404, 'Series not found');

	await requireStaffOrOwner(locals.user.id, series.prototypeCreatedByUserId);

	await cancel(id);
	return { success: true };
});
