import { z } from 'zod';
import { form } from '$app/server';
import { getRequestEvent } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { productionStatuses } from '$lib/server/db/schema/production';
import {
	createProduction as createService,
	updateProductionDetails as updateService,
	transitionProduction as transitionService
} from '$lib/server/production/production-service';
import { getStaffEventPage, getStaffEventProduction, getStaffEvents } from './events.remote';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

/**
 * Productions are guarded as events, not on a `production.*` set of their own.
 *
 * A production is the ops half of one show, and the person who decides its
 * load-in is the person who manages the show — the same argument the venue
 * remotes carry, and a stronger one here, because a production cannot exist
 * without the listing it hangs off. A capability exists when a guard names it;
 * a `production` resource would be one no position's job description mentions,
 * and `config.spec.ts` would accept it only because `staffCapabilities` is
 * derived, which is a technicality rather than a real holder.
 *
 * The one visible consequence: `volunteer_coordinator` holds `event.read` and
 * can therefore read a production. That is already true of the whole console —
 * the advance work lives there — and it is correct.
 */

/** A cleared datetime-local field arrives as '' rather than null. */
function optionalMoment(date?: string, time?: string): Date | null {
	if (!date || !time) return null;
	return buildDateInTz(date, time, DEFAULT_TIMEZONE);
}

const momentFields = {
	loadInDate: z.string().optional(),
	loadInTime: z.string().optional(),
	soundcheckDate: z.string().optional(),
	soundcheckTime: z.string().optional(),
	firstSetDate: z.string().optional(),
	firstSetTime: z.string().optional(),
	curfewDate: z.string().optional(),
	curfewTime: z.string().optional(),
	loadOutDate: z.string().optional(),
	loadOutTime: z.string().optional()
};

export const createProduction = form(
	z.object({ eventId: z.string().min(1) }),
	async ({ eventId }) => {
		await requireCapability('event.manage');
		const { locals } = getRequestEvent();
		try {
			const row = await createService(eventId, { createdByUserId: locals.user?.id });
			await Promise.all([
				getStaffEventPage(eventId).refresh(),
				getStaffEventProduction(eventId).refresh()
			]);
			return { id: row.id };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const updateProduction = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		billingNotes: z.string().max(2000).optional(),
		hospitalityNotes: z.string().max(2000).optional(),
		internalNotes: z.string().max(2000).optional(),
		...momentFields
	}),
	async (data) => {
		await requireCapability('event.manage');
		try {
			await updateService(data.id, {
				loadInAt: optionalMoment(data.loadInDate, data.loadInTime),
				soundcheckAt: optionalMoment(data.soundcheckDate, data.soundcheckTime),
				firstSetAt: optionalMoment(data.firstSetDate, data.firstSetTime),
				curfewAt: optionalMoment(data.curfewDate, data.curfewTime),
				loadOutBy: optionalMoment(data.loadOutDate, data.loadOutTime),
				billingNotes: data.billingNotes || null,
				hospitalityNotes: data.hospitalityNotes || null,
				internalNotes: data.internalNotes || null
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * Who is running the night, as a claim rather than a picker.
 *
 * There is no `production_lead` in the capability matrix, so there is no list
 * of candidates a picker could offer that would mean anything — and the useful
 * question on the day is whether anybody has taken it. `'me'` resolves server
 * side: the client never names a user id, so this cannot be used to assign
 * somebody else their work.
 */
export const setProductionProducer = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		producer: z.enum(['me', 'none'])
	}),
	async (data) => {
		await requireCapability('event.manage');
		const { locals } = getRequestEvent();
		try {
			await updateService(data.id, {
				producerUserId: data.producer === 'me' ? (locals.user?.id ?? null) : null
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const advanceProduction = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		status: z.enum(productionStatuses)
	}),
	async (data) => {
		await requireCapability('event.manage');
		try {
			await transitionService(data.id, data.status);
			await Promise.all([
				getStaffEventProduction(data.eventId).refresh(),
				// The index carries the status column now, so it goes stale here too.
				getStaffEvents({ source: 'cmc' }).refresh()
			]);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);
