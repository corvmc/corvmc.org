import { z } from 'zod';
import { mapDomainError } from '$lib/server/errors';
import { error, invalid } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireStaff, requireUser } from '$lib/server/authorization';
import { requireFeature } from '$lib/server/feature-flags';
import { verifyTurnstile } from '$lib/server/turnstile';
import { getById as getEventById } from '$lib/server/event/event-service';
import { memberReportableEntityTypes, flagStatuses } from '$lib/server/db/schema/flag';
import {
	listFlags,
	getFlag,
	createFlag,
	resolveFlag as resolveFlagSvc,
	FLAG_REASON_MAX,
	FLAG_DESCRIPTION_MAX
} from '$lib/server/flag/flag-service';

// ---------------------------------------------------------------------------
// Queries (staff)
// ---------------------------------------------------------------------------

const flagFiltersSchema = z.object({
	status: z.enum(flagStatuses).optional(),
	search: z.string().optional(),
	page: z.number().optional()
});

export const getFlagsQueue = query(flagFiltersSchema, async (filters) => {
	await requireStaff();
	return listFlags(
		{ status: filters.status, search: filters.search },
		{ page: filters.page ?? 1, pageSize: 25 }
	);
});

export const getFlagDetail = query(z.string(), async (flagId) => {
	await requireStaff();
	try {
		return await getFlag(flagId);
	} catch (err) {
		mapDomainError(err);
	}
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const resolveSchema = z.object({
	flagId: z.string().min(1),
	resolution: z.enum(['resolved', 'dismissed']),
	notes: z.string().max(FLAG_DESCRIPTION_MAX).optional(),
	unpublishEvent: z.boolean().default(false)
});

export const resolveFlag = form(resolveSchema, async (data) => {
	const staff = await requireStaff();
	try {
		await resolveFlagSvc(data.flagId, {
			resolution: data.resolution,
			notes: data.notes,
			staffId: staff.id,
			unpublishEvent: data.unpublishEvent
		});
	} catch (err) {
		mapDomainError(err);
	}
	// Only the detail query is refreshed here. The queue is keyed by its filter
	// args — `getFlagsQueue({})` is not the entry the list page holds, so that
	// call refreshed nothing. The list re-queries on its own when staff navigate
	// back to it, since its cached value is released once it unmounts.
	void getFlagDetail(data.flagId).refresh();
	return { success: true };
});

// Narrowed to memberReportableEntityTypes, NOT the full flagEntityTypes list.
//
// This form takes its entityType and entityId straight from the browser and
// checks nothing about the reporter's relationship to the target — which is
// fine for profiles and public listings, and catastrophic for a private
// conversation: filing a report is what makes a conversation readable by staff,
// so any member could expose a stranger's DMs by guessing a thread id.
//
// Reporting a conversation goes through `reportDirectThread`, which verifies
// participation first.
const submitSchema = z.object({
	entityType: z.enum(memberReportableEntityTypes),
	entityId: z.string().min(1),
	reason: z.string().trim().min(1).max(FLAG_REASON_MAX),
	description: z.string().trim().max(FLAG_DESCRIPTION_MAX).optional()
});

export const submitFlag = form(submitSchema, async (data) => {
	await requireFeature('contentFlags');
	const reporter = requireUser();
	try {
		await createFlag({
			entityType: data.entityType,
			entityId: data.entityId,
			reportedByUserId: reporter.id,
			reportedByName: reporter.name,
			reason: data.reason,
			description: data.description
		});
	} catch (err) {
		mapDomainError(err);
	}
	return { success: true };
});

// ---------------------------------------------------------------------------
// Public event reporting
// ---------------------------------------------------------------------------

// The gig guide is public, so event reports accept anonymous visitors —
// Turnstile-gated like the other public forms. Signed-in users get their
// identity attached automatically.
const submitEventReportSchema = z.object({
	eventId: z.string().min(1),
	reason: z.string().trim().min(1).max(FLAG_REASON_MAX),
	description: z.string().trim().max(FLAG_DESCRIPTION_MAX).optional(),
	turnstileToken: z.string().min(1)
});

export const submitEventReport = form(submitEventReportSchema, async (data, issue) => {
	await requireFeature('contentFlags');

	const { request, locals } = getRequestEvent();
	const ip = request.headers.get('CF-Connecting-IP');
	if (!(await verifyTurnstile(data.turnstileToken, ip))) {
		invalid(issue.turnstileToken('Verification failed. Please try again.'));
	}

	// Only publicly visible events are reportable — mirrors getPublicEventDetail
	// so draft/cancelled events can't be probed by id.
	const evt = await getEventById(data.eventId);
	if (!evt || evt.status !== 'published') error(404, 'Event not found');

	try {
		await createFlag({
			entityType: 'event',
			entityId: data.eventId,
			reportedByUserId: locals.user?.id,
			reportedByName: locals.user?.name,
			reason: data.reason,
			description: data.description
		});
	} catch (err) {
		mapDomainError(err);
	}
	return { success: true };
});

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getFlagsAgainstUser = query(z.string(), async (userId) => {
	await requireStaff();
	const { rows } = await listFlags(
		{ entityType: 'member_profile', entityId: userId },
		{ page: 1, pageSize: 10 }
	);
	return rows;
});

export const getFlagsByUser = query(z.string(), async (userId) => {
	await requireStaff();
	const { rows } = await listFlags({ reportedByUserId: userId }, { page: 1, pageSize: 10 });
	return rows;
});
