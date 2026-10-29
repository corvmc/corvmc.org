import type { getProjectDetail } from '$lib/remote/projects.remote';
import {
	clubToday,
	contractorJobStatusLabels,
	contractorJobStatusesWithoutSpend as WITHOUT_SPEND
} from '$lib/config';
import {
	formatCents,
	formatDateShort,
	formatDateTimeShort,
	formatTime,
	toLocalDate
} from '$lib/utils/format';

/** Pure reading of the task list, kept out of the components so it can be tested. */

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
export type TaskList = ProjectDetail['taskList'];
export type Task = TaskList['tasks'][number];
export type Section = TaskList['sections'][number];

export const TASK_FILTERS = ['all', 'mine', 'open', 'contractors', 'unassigned'] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

export const TASK_FILTER_LABELS: Record<TaskFilter, string> = {
	all: 'All',
	mine: 'Mine',
	open: 'Open to volunteers',
	contractors: 'Contractors',
	unassigned: 'Unassigned'
};

export function parseFilter(raw: string | null): TaskFilter {
	return TASK_FILTERS.includes(raw as TaskFilter) ? (raw as TaskFilter) : 'all';
}

export const isDone = (t: Pick<Task, 'state'>) => t.state === 'done';

export function matchesFilter(
	t: Pick<Task, 'mode' | 'people'>,
	filter: TaskFilter,
	viewerId: string
): boolean {
	switch (filter) {
		case 'all':
			return true;
		case 'mine':
			return t.people.some((p) => p.userId === viewerId);
		case 'open':
			return t.mode === 'open';
		case 'contractors':
			return t.mode === 'contractor';
		case 'unassigned':
			return t.mode === 'unassigned';
	}
}

/**
 * What the checkbox draws. A task with a done condition is the app's to tick,
 * so its states are drawn apart from a hand-ticked one.
 */
export type CheckState =
	'cancelled' | 'ticked' | 'derived_done' | 'derived_open' | 'overdue' | 'open';

export function checkState(
	t: Pick<Task, 'state' | 'doneWhen' | 'resolvedAt' | 'cancelledAt'>
): CheckState {
	if (t.cancelledAt) return 'cancelled';
	if (t.resolvedAt) return 'ticked';
	if (t.doneWhen) return t.state === 'done' ? 'derived_done' : 'derived_open';
	return t.state === 'overdue' ? 'overdue' : 'open';
}

export interface When {
	label: string;
	/** The window runs past the deadline: worth a flag, never a refusal. */
	endsAfterDue: boolean;
	kind: 'window' | 'due' | 'none';
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function windowLabel(startsAt: Date, endsAt: Date): string {
	return sameDay(startsAt, endsAt)
		? `${formatDateTimeShort(startsAt)} – ${formatTime(endsAt)}`
		: `${formatDateTimeShort(startsAt)} – ${formatDateTimeShort(endsAt)}`;
}

/** The window if there is one, otherwise the due date. */
export function whenOf(t: Pick<Task, 'startsAt' | 'endsAt' | 'dueAt'>): When {
	const endsAfterDue = !!(t.endsAt && t.dueAt && t.endsAt > t.dueAt);
	if (t.startsAt && t.endsAt) {
		return { label: windowLabel(t.startsAt, t.endsAt), endsAfterDue, kind: 'window' };
	}
	if (t.dueAt) return { label: `Due ${formatDateShort(t.dueAt)}`, endsAfterDue, kind: 'due' };
	return { label: '—', endsAfterDue: false, kind: 'none' };
}

/**
 * Still open and its deadline (the due date, else the window's end) fell on a
 * club day before today. Compared as club-time `YYYY-MM-DD`, so a task due
 * today is not red at 5pm PT when the UTC date has rolled over.
 */
export function isOverdue(
	t: Pick<Task, 'state' | 'cancelledAt' | 'dueAt' | 'endsAt'>,
	today: string = clubToday()
): boolean {
	const deadline = t.dueAt ?? t.endsAt;
	if (!deadline || t.cancelledAt || t.state === 'done' || t.state === 'cancelled') return false;
	return toLocalDate(deadline) < today;
}

/** A contractor's money on the row: the invoice, else donated, else the quote. */
export function costOf(t: Pick<Task, 'engagement'>): string {
	const e = t.engagement;
	if (!e || (WITHOUT_SPEND as readonly string[]).includes(e.status)) return '';
	if (e.costCents !== null) return formatCents(e.costCents);
	if (e.isDonated) return 'Donated';
	if (e.quotedCents !== null) return `~${formatCents(e.quotedCents)}`;
	return '';
}

export function engagementLabel(e: NonNullable<Task['engagement']>): string {
	// Done is not invoiced: a completed engagement with no cost is still owed one.
	if (e.status === 'completed' && e.costCents === null && !e.isDonated) return 'Awaiting invoice';
	return contractorJobStatusLabels[e.status];
}

export interface SectionGroup {
	section: Section | null;
	tasks: Task[];
	done: number;
	total: number;
}

/**
 * Sections in their order, each with its tasks; the unlabelled group first and
 * only when it holds something. Counts are over every live task in the
 * section, whatever the filter hides.
 */
export function groupBySection(
	sections: Section[],
	tasks: Task[],
	visible: (t: Task) => boolean = () => true
): SectionGroup[] {
	const known = new Set(sections.map((s) => s.id));
	const keyOf = (t: Task) => (t.sectionId && known.has(t.sectionId) ? t.sectionId : null);
	const build = (section: Section | null): SectionGroup => {
		const mine = tasks.filter((t) => keyOf(t) === (section?.id ?? null));
		const live = mine.filter((t) => t.state !== 'cancelled');
		return {
			section,
			tasks: mine.filter(visible),
			done: live.filter(isDone).length,
			total: live.length
		};
	};
	const loose = build(null);
	const groups = sections.map(build);
	return loose.total > 0 || loose.tasks.length > 0 ? [loose, ...groups] : groups;
}
