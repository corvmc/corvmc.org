import { isOverdue } from '#lib/utils/work-order-due.js';
import { matchesProject, parseProjectFilter } from '../volunteer/schedule/project-filter';

/**
 * The Tasks table's filters, chips and groups (#2625), all read from the URL so
 * a filtered view can be linked. Client-safe: no server imports.
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
	maintenanceScheduleId: string | null;
	resolvedAt: Date | null;
	createdAt: Date;
}

export interface ContractorMark {
	name: string;
	late: boolean;
	awaitingInvoice: boolean;
}

export const CHIPS = ['unassigned', 'overdue', 'untimed', 'invoice'] as const;
export type Chip = (typeof CHIPS)[number];

export const KINDS = ['timed', 'untimed', 'recurring', 'contractor'] as const;
export type Kind = (typeof KINDS)[number];

/** Days ahead a dated task may fall; overdue work is always inside. */
export const WINDOWS = [7, 30, 90] as const;
export type Window = (typeof WINDOWS)[number] | 'all';

export type Grouping = 'due' | 'project';

export interface TaskQuery {
	group: Grouping;
	days: Window;
	/** `''`, `'none'`, or a project's id. */
	project: string;
	role: string;
	kind: Kind | '';
	chip: Chip | '';
	done: boolean;
}

const pick = <T extends string>(list: readonly T[], raw: string | null): T | '' =>
	raw && (list as readonly string[]).includes(raw) ? (raw as T) : '';

export function parseTaskQuery(params: URLSearchParams): TaskQuery {
	const days = Number(params.get('days'));
	const project = params.get('project') ?? '';
	return {
		group: params.get('group') === 'project' ? 'project' : 'due',
		days: (WINDOWS as readonly number[]).includes(days) ? (days as Window) : 'all',
		project: project === 'none' || parseProjectFilter(project) === '' ? project : '',
		role: params.get('role') ?? '',
		kind: pick(KINDS, params.get('kind')),
		chip: pick(CHIPS, params.get('chip')),
		done: params.get('done') === '1'
	};
}

/** The query as a search string, defaults left out. */
export function taskQuerySearch(q: TaskQuery): string {
	const pairs: [string, string][] = [];
	if (q.group !== 'due') pairs.push(['group', q.group]);
	if (q.days !== 'all') pairs.push(['days', String(q.days)]);
	if (q.project) pairs.push(['project', q.project]);
	if (q.role) pairs.push(['role', q.role]);
	if (q.kind) pairs.push(['kind', q.kind]);
	if (q.chip) pairs.push(['chip', q.chip]);
	if (q.done) pairs.push(['done', '1']);
	return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** The date a task sits under: its shift's, else its deadline. */
export const whenOf = (t: TaskFacts): Date | null => t.shiftAt ?? t.dueAt;

const isOpen = (t: TaskFacts) => t.resolvedAt === null;

/** What a chip counts. Only open work, except the invoice still owed on done work. */
export function matchesChip(chip: Chip, t: TaskFacts, marks: ContractorMark[], now: Date) {
	const nobody = t.assignees === 0 && marks.length === 0 && t.shifts === 0;
	switch (chip) {
		case 'unassigned':
			return isOpen(t) && nobody;
		case 'overdue':
			return isOpen(t) && isOverdue(t, now);
		case 'untimed':
			return isOpen(t) && nobody && t.volunteerRoleId !== null;
		case 'invoice':
			return marks.some((m) => m.awaitingInvoice);
	}
}

export function matchesKind(kind: Kind | '', t: TaskFacts, marks: ContractorMark[]) {
	switch (kind) {
		case 'timed':
			return t.shifts > 0;
		case 'untimed':
			return t.shifts === 0;
		case 'recurring':
			return t.maintenanceScheduleId !== null;
		case 'contractor':
			return marks.length > 0;
		default:
			return true;
	}
}

export function matchesWindow(days: Window, t: TaskFacts, now: Date) {
	const when = whenOf(t);
	if (days === 'all' || !when) return true;
	return when.getTime() <= now.getTime() + days * 86_400_000;
}

export function matchesTaskProject(filter: string, t: TaskFacts) {
	if (filter === '' || filter === 'none') return matchesProject(t, filter);
	return t.projectId === filter;
}

/** Soonest first, undated last, then oldest created. */
export function byWhen(a: TaskFacts, b: TaskFacts): number {
	const wa = whenOf(a)?.getTime() ?? Infinity;
	const wb = whenOf(b)?.getTime() ?? Infinity;
	if (wa !== wb) return wa < wb ? -1 : 1;
	return a.createdAt.getTime() - b.createdAt.getTime();
}

/** Tasks in no project first, then projects by name; each group keeps the order given. */
export function groupByProject<T extends TaskFacts>(
	rows: T[]
): { projectId: string | null; rows: T[] }[] {
	const groups = new Map<string | null, T[]>();
	for (const r of rows) {
		const list = groups.get(r.projectId);
		if (list) list.push(r);
		else groups.set(r.projectId, [r]);
	}
	return [...groups.entries()]
		.map(([projectId, list]) => ({ projectId, rows: list }))
		.sort((a, b) => {
			if (a.projectId === null) return -1;
			if (b.projectId === null) return 1;
			return (a.rows[0].projectName ?? '').localeCompare(b.rows[0].projectName ?? '');
		});
}
