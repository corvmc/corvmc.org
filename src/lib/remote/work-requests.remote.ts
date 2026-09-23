import { z } from 'zod';
import { query } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { DEFAULT_TIMEZONE } from '$lib/config';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import {
	dismissFlag,
	getWorkRequestDetail,
	listWorkRequests,
	sendToWorkOrder,
	workRequestStages
} from '$lib/server/inventory/work-request-service';

/**
 * Equipment reports — the staff triage half. Members raise them through
 * `reportAssetDamage`; this is where somebody reads them. Rendered on the flags
 * surface (#552), guarded by inventory, not moderation.
 */

export const getEquipmentReportQueue = query(
	z.object({
		stage: z.enum(workRequestStages).optional(),
		search: z.string().max(200).optional(),
		page: z.number().int().min(1).optional()
	}),
	async (filters) => {
		await requireCapability('inventory.manageAssets');
		return listWorkRequests(
			{ stage: filters.stage, search: filters.search },
			{ page: filters.page ?? 1, pageSize: 25 }
		);
	}
);

export const getEquipmentReport = query(z.string(), async (id) => {
	await requireCapability('inventory.manageAssets');
	try {
		return await getWorkRequestDetail(id);
	} catch (err) {
		mapDomainError(err);
	}
});

export const dismissEquipmentReport = form(
	z.object({ id: z.string().min(1), notes: z.string().max(1000).optional() }),
	async (data) => {
		const staff = await requireCapability('inventory.manageAssets');
		await dismissFlag(data.id, staff.id, data.notes || undefined);
		void getEquipmentReport(data.id).refresh();
		return { success: true };
	}
);

/**
 * `workOrderId` empty means "raise a new one", which then needs a role — and
 * creating work is the volunteer coordinator's capability as well as ours.
 */
export const sendEquipmentReportToWorkOrder = form(
	z.object({
		id: z.string().min(1),
		workOrderId: z.string().optional(),
		volunteerRoleId: z.string().optional(),
		dueAt: z.string().optional(),
		notes: z.string().max(500).optional()
	}),
	async (data, issue) => {
		const staff = await requireCapability('inventory.manageAssets');
		let result;
		if (data.workOrderId) {
			result = await sendToWorkOrder(data.id, { workOrderId: data.workOrderId }, staff.id);
		} else {
			await requireCapability('volunteer.manageShifts');
			if (!data.volunteerRoleId) {
				invalid(issue.volunteerRoleId('Pick who should do the work'));
			}
			result = await sendToWorkOrder(
				data.id,
				{
					newOrder: {
						volunteerRoleId: data.volunteerRoleId!,
						notes: data.notes || null,
						dueAt: data.dueAt ? buildDateInTz(data.dueAt, '12:00', DEFAULT_TIMEZONE) : null
					}
				},
				staff.id
			);
		}
		void getEquipmentReport(data.id).refresh();
		return { success: true, ...result };
	}
);
