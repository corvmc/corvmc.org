import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { can, requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { dutyListAnchors, dutyListSubjects, workDoneConditions } from '$lib/config';
import { listCommittees } from '$lib/server/project/project-service';
import { listVolunteerRoles } from '$lib/server/volunteer/volunteer-role-service';
import {
	addDutyListItem as addItemService,
	applyDutyList as applyService,
	createDutyList as createService,
	deleteDutyList as deleteService,
	getDutyListDetail,
	listDutyLists,
	projectOfEvent,
	removeDutyListItem as removeItemService,
	setWorkTaskDone as setTaskService,
	updateDutyList as updateService,
	updateDutyListItem as updateItemService
} from '$lib/server/volunteer/duty-list-service';
import { getStaffShiftPage, getVolunteerWorklist, getWorkOrderActivity } from './volunteer.remote';
import { getProjectTaskPage } from './tasks.remote';
import { getProjectActivity } from './projects.remote';
import { workOrderProjectId } from '$lib/server/volunteer/work-order-service';

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

/** The apply picker: project templates worth applying, never the orientation one. */
export const getActiveDutyLists = query(async () => {
	await requireCapability('volunteer.read');
	const lists = await listDutyLists({ subject: 'project' });
	return lists.filter((l) => l.itemCount > 0);
});

/** One load-bearing query for `/staff/volunteer/duty-lists/[id]`. */
export const getDutyListPage = query(z.string(), async (id) => {
	await requireCapability('volunteer.read');

	const detail = await getDutyListDetail(id);
	if (!detail) error(404, 'Duty list not found');

	const [roles, committees] = await Promise.all([listVolunteerRoles(), listCommittees()]);

	return {
		list: detail.list,
		items: detail.items,
		roles: roles.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name, group: r.group })),
		committees
	};
});

// ---------------------------------------------------------------------------
// Duty list forms
// ---------------------------------------------------------------------------

export const createDutyList = form(
	z.object({
		name: z.string().min(1, 'Name is required'),
		description: z.string().optional(),
		anchor: z.enum(dutyListAnchors).default('doors'),
		subject: z.enum(dutyListSubjects).default('project')
	}),
	async (data) => {
		const staff = await requireCapability('volunteer.manageRoles');
		try {
			const list = await createService({
				name: data.name,
				description: data.description,
				anchor: data.anchor,
				subject: data.subject,
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
		subject: z.enum(dutyListSubjects).optional(),
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
				subject: data.subject,
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

/** Whose job the item is, and what fact says it is done. Blank owner is staff's. */
const ownershipShape = {
	title: z.string().optional(),
	groupId: z.string().optional(),
	doneWhen: z.enum(['', ...workDoneConditions]).optional()
};

function ownershipInput(data: { title?: string; groupId?: string; doneWhen?: string }) {
	return {
		title: data.title ?? null,
		groupId: data.groupId || null,
		doneWhen: (data.doneWhen || null) as (typeof workDoneConditions)[number] | null
	};
}

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
	tasks: z.string().optional(),
	...ownershipShape
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
	title?: string;
	groupId?: string;
	doneWhen?: string;
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
		tasks: parseTasks(data.tasks),
		...ownershipInput(data)
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

/** Re-own an item, retitle it, or change what says it is done. Applied shows keep their copy. */
export const updateDutyListItem = form(
	z.object({ id: z.string().min(1), dutyListId: z.string().min(1), ...ownershipShape }),
	async (data) => {
		await requireCapability('volunteer.manageRoles');
		try {
			await updateItemService(data.id, ownershipInput(data));
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

/** Apply a template from a show's console: into its project, timed from this show. */
export const applyDutyList = form(
	z.object({
		dutyListId: z.string().min(1),
		eventId: z.string().min(1),
		reason: z.string().max(500).optional()
	}),
	async (data) => {
		const staff = await requireCapability('volunteer.manageShifts');
		try {
			const projectId = await projectOfEvent(data.eventId);
			if (!projectId) error(422, 'This event has no project to apply a template to.');
			const result = await applyService(
				data.dutyListId,
				{ kind: 'project', id: projectId, eventId: data.eventId },
				staff.id,
				{ reason: data.reason }
			);
			// The advance items land unscheduled, which is the coordinator's queue on
			// Today. Without this the card the apply just filled stays empty until
			// somebody navigates.
			await getVolunteerWorklist().refresh();
			return {
				workOrders: result.workOrderIds.length,
				tasks: result.taskCount,
				warnings: result.warnings
			};
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
			const projectId = await workOrderProjectId(data.shiftId);
			// Whichever page is canonical for it; the task page's guard is the project's.
			const workOrderId = data.shiftId;
			if (!projectId) {
				void getWorkOrderActivity({ workOrderId }).refresh();
				await getStaffShiftPage(workOrderId).refresh();
			} else if (await can('project.read')) {
				void getProjectActivity({ projectId, workOrderId }).refresh();
				await getProjectTaskPage({ projectId, workOrderId }).refresh();
			}
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);
