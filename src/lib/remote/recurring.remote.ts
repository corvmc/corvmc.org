import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, getRequestEvent } from '$app/server';
import { form } from './_remote';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import { recurringSeriesEnd, UNTIL_BEFORE_START } from '#lib/server/reservation/series-until.js';
import {
	previewReschedule,
	reschedule,
	type NewSchedule
} from '#lib/server/reservation/recurring-series-reschedule.js';
import {
	requireCapability,
	requireCapabilityOrOwner,
	requireUser
} from '#lib/server/authorization.js';
import { mapDomainError } from '#lib/server/errors.js';
import {
	get,
	getHistory,
	cancel,
	listAll as listAllSeries
} from '#lib/server/reservation/recurring-series-service.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getSeries = query(z.string(), async (id) => {
	await requireCapability('reservation.read');
	const series = await get(id);
	if (!series) error(404, 'Series not found');
	return series;
});

export const getSeriesHistory = query(z.string(), async (id) => {
	await requireCapability('reservation.read');
	return getHistory(id);
});

const staffRecurringFilters = z.object({
	filter: z.string().optional(),
	page: z.number().optional()
});

export const getStaffRecurring = query(staffRecurringFilters, async (filters) => {
	await requireCapability('reservation.read');
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
	const staff = await requireCapability('reservation.manageRecurring');
	try {
		await cancel(data.seriesId as string, { kind: 'staff', userId: staff.id });
	} catch (err) {
		mapDomainError(err);
	}
	return { success: true };
});

/** Cancel from detail page (takes seriesId in form data) */
export const cancelDetailSeries = form(z.object({ seriesId: z.string() }), async (data) => {
	const staff = await requireCapability('reservation.manageRecurring');
	const seriesId = data.seriesId as string;
	try {
		await cancel(seriesId, { kind: 'staff', userId: staff.id });
	} catch (err) {
		mapDomainError(err);
	}
	void getStaffSeriesDetail(seriesId).refresh();
	return { success: true };
});

/** Cancel from member page / CancelSeriesAction (owner or staff) */
export const cancelRecurringSeries = form(z.object({ id: z.string() }), async (data) => {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = data.id as string;
	const series = await get(id);
	if (!series) throw error(404, 'Series not found');

	const as = await requireCapabilityOrOwner(
		'reservation.manageRecurring',
		series.prototypeCreatedByUserId
	);

	try {
		await cancel(id, { kind: as, userId: locals.user.id });
	} catch (err) {
		mapDomainError(err);
	}
	return { success: true };
});

/** The recurring series detail page's one load-bearing query. */
export const getStaffSeriesDetail = query(z.string(), async (id) => {
	const [series, history] = await Promise.all([getSeries(id), getSeriesHistory(id)]);
	return { series, history };
});

// ---------------------------------------------------------------------------
// Schedule changes — owner or staff
// ---------------------------------------------------------------------------

const scheduleSchema = z.object({
	id: z.string(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	startTime: z.string().regex(/^\d{2}:\d{2}$/),
	endTime: z.string().regex(/^\d{2}:\d{2}$/),
	frequency: z.enum(['weekly', 'biweekly', 'monthly']),
	monthlyMode: z.enum(['weekday', 'monthday']).optional(),
	until: z.string().optional()
});
type ScheduleInput = z.infer<typeof scheduleSchema>;

/** The series' owner, or staff who may manage recurring bookings. */
async function seriesEditor(id: string): Promise<'staff' | 'owner'> {
	const series = await get(id);
	if (!series) error(404, 'Series not found');
	return requireCapabilityOrOwner('reservation.manageRecurring', series.prototypeCreatedByUserId);
}

function toSchedule(data: ScheduleInput, until: Date | undefined): NewSchedule {
	return {
		startsAt: buildDateInTz(data.date, data.startTime, DEFAULT_TIMEZONE),
		endsAt: buildDateInTz(data.date, data.endTime, DEFAULT_TIMEZONE),
		frequency: data.frequency,
		monthlyMode: data.frequency === 'monthly' ? data.monthlyMode : undefined,
		until
	};
}

const seriesEnd = (data: ScheduleInput) =>
	recurringSeriesEnd({ recurring: data.frequency, date: data.date, recurringUntil: data.until });

/** What a schedule change would do, before it is saved. */
export const previewSeriesSchedule = query(scheduleSchema, async (data) => {
	requireUser();
	await seriesEditor(data.id);
	try {
		return await previewReschedule(data.id, toSchedule(data, seriesEnd(data) ?? undefined));
	} catch (err) {
		mapDomainError(err);
	}
});

/** Replace a series with one on a new schedule (owner or staff). */
export const rescheduleSeries = form(scheduleSchema, async (data, issue) => {
	const user = requireUser();
	const as = await seriesEditor(data.id);
	const until = seriesEnd(data);
	if (until === null) invalid(issue.until(UNTIL_BEFORE_START));

	const outcome = await reschedule(data.id, toSchedule(data, until), {
		kind: as,
		userId: user.id
	});
	return { seriesId: outcome.seriesId, waitlisted: outcome.waitlisted, kept: outcome.kept };
});
