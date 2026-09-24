import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { can, requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { DEFAULT_TIMEZONE, incidentCategories, incidentStatusFilters } from '$lib/config';
import { requireShowCrew } from '$lib/server/volunteer/show-crew';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import {
	acceptIncident,
	addIncidentNote,
	fileShowIncident,
	getIncident,
	listIncidents,
	recordIncident,
	reopenIncident,
	resolveIncident,
	INCIDENT_DESCRIPTION_MAX,
	INCIDENT_LOCATION_MAX,
	INCIDENT_NOTE_MAX,
	INCIDENT_SUMMARY_MAX
} from '$lib/server/incident/incident-service';

/**
 * The incident & safety log — every surface staff-only, behind `incident.*`.
 * A report can name a member, and that member cannot read it.
 */

const filtersSchema = z.object({
	status: z.enum(incidentStatusFilters).optional(),
	category: z.enum(incidentCategories).optional(),
	search: z.string().max(200).optional(),
	page: z.number().int().min(1).optional()
});

export const getIncidentLog = query(filtersSchema, async (filters) => {
	await requireCapability('incident.read');
	const [result, canRecord] = await Promise.all([
		listIncidents(
			{ status: filters.status, category: filters.category, search: filters.search },
			{ page: filters.page ?? 1, pageSize: 25 }
		),
		can('incident.record')
	]);
	return { ...result, canRecord };
});

export const getIncidentDetail = query(z.string(), async (id) => {
	await requireCapability('incident.read');
	try {
		const [incident, canRecord] = await Promise.all([getIncident(id), can('incident.record')]);
		return { ...incident, canRecord };
	} catch (err) {
		mapDomainError(err);
	}
});

const accountFields = {
	occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date it happened'),
	occurredAt: z.string().regex(/^\d{2}:\d{2}$/, 'Pick roughly what time'),
	category: z.enum(incidentCategories, { message: 'Pick what kind of incident' }),
	summary: z.string().trim().min(1).max(INCIDENT_SUMMARY_MAX),
	description: z.string().trim().min(1).max(INCIDENT_DESCRIPTION_MAX),
	location: z.string().max(INCIDENT_LOCATION_MAX).optional()
};

export const recordIncidentForm = form(
	z.object({ ...accountFields, involvedUserId: z.string().optional() }),
	async (data) => {
		const staff = await requireCapability('incident.record');
		const row = await recordIncident(
			{
				occurredAt: buildDateInTz(data.occurredOn, data.occurredAt, DEFAULT_TIMEZONE),
				category: data.category,
				summary: data.summary,
				description: data.description,
				location: data.location,
				involvedUserId: data.involvedUserId || null
			},
			{ id: staff.id, name: staff.name }
		);
		return { success: true, id: row.id };
	}
);

export const addIncidentNoteForm = form(
	z.object({
		incidentId: z.string().min(1),
		body: z.string().trim().min(1).max(INCIDENT_NOTE_MAX)
	}),
	async (data) => {
		const staff = await requireCapability('incident.record');
		await addIncidentNote(data.incidentId, data.body, { id: staff.id, name: staff.name });
		void getIncidentDetail(data.incidentId).refresh();
		return { success: true };
	}
);

export const resolveIncidentForm = form(
	z.object({
		incidentId: z.string().min(1),
		resolution: z.string().trim().min(1, 'Say how it was resolved').max(INCIDENT_NOTE_MAX)
	}),
	async (data) => {
		const staff = await requireCapability('incident.record');
		await resolveIncident(data.incidentId, data.resolution, { id: staff.id, name: staff.name });
		void getIncidentDetail(data.incidentId).refresh();
		return { success: true };
	}
);

export const reopenIncidentForm = form(
	z.object({ incidentId: z.string().min(1) }),
	async (data) => {
		const staff = await requireCapability('incident.record');
		await reopenIncident(data.incidentId, { id: staff.id, name: staff.name });
		void getIncidentDetail(data.incidentId).refresh();
		return { success: true };
	}
);

/**
 * Crew of a show file from their shift (#1469). The filing lands `reported`;
 * staff accept or complete it. The guard is holding a shift on this event.
 */
export const fileShowIncidentForm = form(
	z.object({ ...accountFields, eventId: z.string().min(1) }),
	async (data) => {
		const filer = await requireShowCrew(data.eventId);
		try {
			await fileShowIncident(
				{
					eventId: data.eventId,
					occurredAt: buildDateInTz(data.occurredOn, data.occurredAt, DEFAULT_TIMEZONE),
					category: data.category,
					summary: data.summary,
					description: data.description,
					location: data.location
				},
				{ id: filer.id, name: filer.name }
			);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

export const acceptIncidentForm = form(
	z.object({ incidentId: z.string().min(1) }),
	async (data) => {
		await requireCapability('incident.record');
		try {
			await acceptIncident(data.incidentId);
		} catch (err) {
			mapDomainError(err);
		}
		void getIncidentDetail(data.incidentId).refresh();
		return { success: true };
	}
);
