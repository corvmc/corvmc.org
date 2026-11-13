import type { ProjectKind, ProjectStatus } from '#lib/config.js';
import { isOverdue } from './work-order-due';

/**
 * A task as the Tasks table (#2625) and `RelatedTasks` read it, and the chips
 * both count. Client-safe: no server imports.
 */

export interface TaskFacts {
	id: string;
	volunteerRoleId: string | null;
	projectId: string | null;
	projectName: string | null;
	dueAt: Date | null;
	shiftAt: Date | null;
	shifts: number;
	assignees: number;
	/** Open tasks it waits on: Blocked above zero, derived on read (#2625). */
	blockers: number;
	maintenanceScheduleId: string | null;
	resolvedAt: Date | null;
	createdAt: Date;
}

/** One row of the Tasks table: a task, whatever project it is in, if any. */
export interface TaskRow extends TaskFacts {
	title: string | null;
	roleName: string | null;
	eventId: string | null;
	eventTitle: string | null;
	projectKind: ProjectKind | null;
	projectStatus: ProjectStatus | null;
	/** The next live shift still to end, else the last live one; null with no live shift. */
	shiftAt: Date | null;
	/** Places across its live shifts, and how many are taken. */
	capacity: number;
	claimed: number;
	pendingCapacity: number | null;
}

export interface ContractorMark {
	name: string;
	late: boolean;
	awaitingInvoice: boolean;
}

export const CHIPS = ['unassigned', 'overdue', 'blocked', 'untimed', 'invoice'] as const;
export type Chip = (typeof CHIPS)[number];

/** The date a task sits under: its shift's, else its deadline. */
export const whenOf = (t: TaskFacts): Date | null => t.shiftAt ?? t.dueAt;

const isOpen = (t: TaskFacts) => t.resolvedAt === null;

/** Nobody is on it: no assignee, no contractor, no shift. */
export const isUnstaffed = (t: TaskFacts, marks: ContractorMark[]) =>
	t.assignees === 0 && marks.length === 0 && t.shifts === 0;

/** What a chip counts. Only open work, except the invoice still owed on done work. */
export function matchesChip(chip: Chip, t: TaskFacts, marks: ContractorMark[], now: Date) {
	const nobody = isUnstaffed(t, marks);
	switch (chip) {
		case 'unassigned':
			return isOpen(t) && nobody;
		case 'overdue':
			return isOpen(t) && isOverdue(t, now);
		case 'blocked':
			return isOpen(t) && t.blockers > 0;
		case 'untimed':
			return isOpen(t) && nobody && t.volunteerRoleId !== null;
		case 'invoice':
			return marks.some((m) => m.awaitingInvoice);
	}
}

/** Soonest first, undated last, then oldest created. */
export function byWhen(a: TaskFacts, b: TaskFacts): number {
	const wa = whenOf(a)?.getTime() ?? Infinity;
	const wb = whenOf(b)?.getTime() ?? Infinity;
	if (wa !== wb) return wa < wb ? -1 : 1;
	return a.createdAt.getTime() - b.createdAt.getTime();
}
