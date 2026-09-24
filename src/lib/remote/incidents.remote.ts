import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { DEFAULT_TIMEZONE, incidentCategories, incidentStatuses } from '$lib/config';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import {
	addIncidentNote,
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
	status: z.enum(incidentStatuses).optional(),
	category: z.enum(incidentCategories).optional(),
	search: z.string().max(200).optional(),
	page: z.number().int().min(1).optional()
});

export const getIncidentLog = query(filtersSchema, async (filters) => {
	await requireCapability('incident.read');
	return listIncidents(
		{ status: filters.status, category: filters.category, search: filters.search },
		{ page: filters.page ?? 1, pageSize: 25 }
	);
});

export const getIncidentDetail = query(z.string(), async (id) => {
	await requireCapability('incident.read');
	try {
		return await getIncident(id);
	} catch (err) {
		mapDomainError(err);
	}
});

export const recordIncidentForm = form(
	z.object({
		occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date it happened'),
		occurredAt: z.string().regex(/^\d{2}:\d{2}$/, 'Pick roughly what time'),
		category: z.enum(incidentCategories, { message: 'Pick what kind of incident' }),
		summary: z.string().trim().min(1).max(INCIDENT_SUMMARY_MAX),
		description: z.string().trim().min(1).max(INCIDENT_DESCRIPTION_MAX),
		location: z.string().max(INCIDENT_LOCATION_MAX).optional(),
		involvedUserId: z.string().optional()
	}),
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
