import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { dutyListAnchors } from '$lib/config';
import { listVolunteerRoles } from '$lib/server/volunteer/volunteer-role-service';
import {
	addDutyListItem as addItemService,
	applyDutyList as applyService,
	createDutyList as createService,
	deleteDutyList as deleteService,
	getDutyListDetail,
	listDutyLists,
	removeDutyListItem as removeItemService,
	setWorkTaskDone as setTaskService,
	updateDutyList as updateService,
	updateDutyListItem as updateItemService
} from '$lib/server/volunteer/duty-list-service';
import { getStaffShiftPage, getVolunteerWorklist } from './volunteer.remote';

/**
 * Staff-only throughout. Duty lists are a coordinator's tool — members meet them
 * only as the work orders they produce, which the volunteering surfaces already
 * render.
 */

// ---------------------------------------------------------------------------
// Offsets
// ---------------------------------------------------------------------------

const offsetUnits = ['minutes', 'hours', 'days'] as const;
const UNIT_MINUTES: Record<(typeof offsetUnits)[number], number> = {
	minutes: 1,
	hours: 60,
	days: 1440
};

/**
 * Staff type "3 hours before", not "-180".
 *
 * A week before doors is -10080 minutes, which is not a number anybody should be
 * asked to work out. The column stays signed minutes; the form does the sum.
 */
function toMinutes(amount: string | undefined, unit: string, direction: string): number | null {
	if (amount === undefined || amount.trim() === '') return null;
	const n = Number(amount);
	if (!Number.isFinite(n)) return null;
	const unitKey = (offsetUnits as readonly string[]).includes(unit)
		? (unit as (typeof offsetUnits)[number])
		: 'minutes';
	const magnitude = Math.round(Math.abs(n) * UNIT_MINUTES[unitKey]);
	return direction === 'before' ? -magnitude : magnitude;
}

/** One task per line, which is how a checklist is written down anywhere else. */
function parseTasks(raw: string | undefined): string[] {
	return (raw ?? '')
		.split('\n')
		.map((t) => t.trim())
		.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getDutyLists = query(async () => {
	await requireCapability('volunteer.read');
	return listDutyLists({ includeInactive: true });
});

/** The picker on the production console: only lists worth applying. */
export const getActiveDutyLists = query(async () => {
	await requireCapability('volunteer.read');
	const lists = await listDutyLists();
	return lists.filter((l) => l.itemCount > 0);
});

/** One load-bearing query for `/staff/volunteer/duty-lists/[id]`. */
export const getDutyListPage = query(z.string(), async (id) => {
	await requireCapability('volunteer.read');

	const detail = await getDutyListDetail(id);
	if (!detail) error(404, 'Duty list not found');

	const roles = await listVolunteerRoles();

	return {
		list: detail.list,
		items: detail.items,
		roles: roles.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name, group: r.group }))
	};
});

// ---------------------------------------------------------------------------
// Duty list forms
// ---------------------------------------------------------------------------

export const createDutyList = form(
	z.object({
		name: z.string().min(1, 'Name is required'),
		description: z.string().optional(),
		anchor: z.enum(dutyListAnchors).default('doors')
	}),
	async (data) => {
		const staff = await requireCapability('volunteer.manageRoles');
		try {
			const list = await createService({
				name: data.name,
				description: data.description,
				anchor: data.anchor,
				createdByUserId: staff.id
			});
			await getDutyLists().refresh();
			return { id: list.id };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const updateDutyList = form(
	z.object({
		id: z.string().min(1),
		name: z.string().optional(),
		description: z.string().optional(),
		anchor: z.enum(dutyListAnchors).optional(),
		// `.optional().default(false)`, never a bare required boolean: an unchecked
		// box is not submitted at all, and kit reports the absence as the boolean's
		// own validation failure.
		isActive: z.boolean().optional().default(false)
	}),
	async (data) => {
		await requireCapability('volunteer.manageRoles');
		try {
			await updateService(data.id, {
				name: data.name,
				description: data.description,
				anchor: data.anchor,
				isActive: data.isActive
			});
			await Promise.all([getDutyLists().refresh(), getDutyListPage(data.id).refresh()]);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const deleteDutyList = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('volunteer.manageRoles');
	try {
		await deleteService(data.id);
		await getDutyLists().refresh();
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

// ---------------------------------------------------------------------------
// Item forms
// ---------------------------------------------------------------------------

const itemShape = {
	volunteerRoleId: z.string().min(1, 'Pick a role'),
	/** `scheduled` uses the offset and duration; `due` uses the offset alone. */
	kind: z.enum(['scheduled', 'due']).default('scheduled'),
	offsetAmount: z.string().optional(),
	offsetUnit: z.enum(offsetUnits).default('hours'),
	offsetDirection: z.enum(['before', 'after']).default('before'),
	durationMinutes: z.string().optional(),
	capacity: z.string().default('1'),
	notes: z.string().optional(),
	sortOrder: z.string().default('0'),
	tasks: z.string().optional()
};

function itemInput(data: {
	volunteerRoleId: string;
	kind: 'scheduled' | 'due';
	offsetAmount?: string;
	offsetUnit: (typeof offsetUnits)[number];
	offsetDirection: 'before' | 'after';
	durationMinutes?: string;
	capacity: string;
	notes?: string;
	sortOrder: string;
	tasks?: string;
}) {
	const offset = toMinutes(data.offsetAmount, data.offsetUnit, data.offsetDirection);
	const scheduled = data.kind === 'scheduled';
	const duration =
		data.durationMinutes && data.durationMinutes.trim() !== ''
			? parseInt(data.durationMinutes, 10)
			: null;

	return {
		volunteerRoleId: data.volunteerRoleId,
		offsetMinutes: scheduled ? offset : null,
		durationMinutes: scheduled ? duration : null,
		dueOffsetMinutes: scheduled ? null : offset,
		capacity: parseInt(data.capacity, 10),
		notes: data.notes,
		sortOrder: parseInt(data.sortOrder, 10) || 0,
		tasks: parseTasks(data.tasks)
	};
}

export const addDutyListItem = form(
	z.object({ dutyListId: z.string().min(1), ...itemShape }),
	async (data) => {
		await requireCapability('volunteer.manageRoles');
		try {
			await addItemService(data.dutyListId, itemInput(data));
			await Promise.all([getDutyListPage(data.dutyListId).refresh(), getDutyLists().refresh()]);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const updateDutyListItem = form(
	z.object({ id: z.string().min(1), dutyListId: z.string().min(1), ...itemShape }),
	async (data) => {
		await requireCapability('volunteer.manageRoles');
		try {
			await updateItemService(data.id, itemInput(data));
			await getDutyListPage(data.dutyListId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const removeDutyListItem = form(
	z.object({ id: z.string().min(1), dutyListId: z.string().min(1) }),
	async (data) => {
		await requireCapability('volunteer.manageRoles');
		try {
			await removeItemService(data.id);
			await Promise.all([getDutyListPage(data.dutyListId).refresh(), getDutyLists().refresh()]);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

// ---------------------------------------------------------------------------
// Applying, and ticking
// ---------------------------------------------------------------------------

export const applyDutyList = form(
	z.object({ dutyListId: z.string().min(1), eventId: z.string().min(1) }),
	async (data) => {
		const staff = await requireCapability('volunteer.manageShifts');
		try {
			const result = await applyService(data.dutyListId, data.eventId, staff.id);
			// The advance items land unscheduled, which is the coordinator's queue on
			// Today. Without this the card the apply just filled stays empty until
			// somebody navigates.
			await getVolunteerWorklist().refresh();
			return { workOrders: result.workOrderIds.length, tasks: result.taskCount };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const setWorkTaskDone = form(
	z.object({
		id: z.string().min(1),
		/** Which work order's page to put back in sync. Not read by the service. */
		shiftId: z.string().min(1),
		// Unchecked boxes are not submitted, so this has to tolerate absence and
		// read it as false rather than as a missing required field.
		done: z.boolean().optional().default(false)
	}),
	async (data) => {
		const staff = await requireCapability('volunteer.manageShifts');
		try {
			await setTaskService(data.id, data.done, staff.id);
			await getStaffShiftPage(data.shiftId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);
