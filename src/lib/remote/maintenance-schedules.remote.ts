import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { DEFAULT_TIMEZONE, VOLUNTEER_SHIFT_NOTES_MAX } from '$lib/config';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { listVolunteerRoles } from '$lib/server/volunteer/volunteer-role-service';
import { listProjects } from '$lib/server/project/project-service';
import {
	createMaintenanceSchedule as createService,
	listMaintenanceSchedules,
	retireMaintenanceSchedule as retireService
} from '$lib/server/volunteer/maintenance-schedule-service';
import { searchAssetOptions } from '$lib/server/inventory/asset-service';
import { getVolunteerWorklist } from './volunteer.remote';

/**
 * Recurring facility work — staff-only. Members meet it only as the ordinary
 * work orders it writes, one at a time.
 */

/** One load-bearing query for `/staff/volunteer/recurring`: rows plus the form's options. */
export const getRecurringWorkPage = query(async () => {
	await requireCapability('volunteer.read');
	const [schedules, roles, projects] = await Promise.all([
		listMaintenanceSchedules(),
		listVolunteerRoles(),
		listProjects()
	]);
	return {
		schedules,
		roles: roles.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name })),
		projects: projects
			.filter((p) => p.status !== 'done' && p.status !== 'declined')
			.map((p) => ({ id: p.id, name: p.name }))
	};
});

/**
 * The asset picker behind recurring work and the shift form. Guarded like those
 * forms: a volunteer coordinator has no `inventory.read`.
 */
export const searchWorkAssets = query(z.string(), async (q) => {
	await requireCapability('volunteer.manageShifts');
	return searchAssetOptions(q);
});

export const createRecurringWork = form(
	z.object({
		name: z.string().min(1, 'Name is required'),
		volunteerRoleId: z.string().min(1, 'Pick a role'),
		intervalDays: z.string().min(1, 'How often does it repeat?'),
		// `YYYY-MM-DD`; anchored at noon club time, like every calendar date here.
		firstDueOn: z.string().min(1, 'When is the first one due?'),
		// A cleared select posts '', which `.optional()` alone would reject.
		projectId: z.union([z.literal(''), z.uuid()]).optional(),
		assetId: z.string().optional(),
		capacity: z.string().optional(),
		notes: z.string().max(VOLUNTEER_SHIFT_NOTES_MAX).optional()
	}),
	async (data) => {
		const staff = await requireCapability('volunteer.manageShifts');
		try {
			await createService({
				name: data.name,
				volunteerRoleId: data.volunteerRoleId,
				intervalDays: parseInt(data.intervalDays, 10),
				firstDueAt: buildDateInTz(data.firstDueOn, '12:00', DEFAULT_TIMEZONE),
				projectId: data.projectId || null,
				assetId: data.assetId || null,
				capacity: data.capacity ? parseInt(data.capacity, 10) : 1,
				notes: data.notes,
				createdByUserId: staff.id
			});
		} catch (err) {
			mapDomainError(err);
		}
		await Promise.all([getRecurringWorkPage().refresh(), getVolunteerWorklist().refresh()]);
		return { success: true };
	}
);

export const retireRecurringWork = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('volunteer.manageShifts');
	try {
		await retireService(data.id);
	} catch (err) {
		mapDomainError(err);
	}
	await getRecurringWorkPage().refresh();
	return { success: true };
});
