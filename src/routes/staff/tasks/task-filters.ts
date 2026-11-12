import { matchesProject, parseProjectFilter } from '../volunteer/schedule/project-filter';
import {
	CHIPS,
	whenOf,
	type Chip,
	type ContractorMark,
	type TaskFacts
} from '#lib/utils/task-facts.js';

import { relatedSubjectTypes, type RelatedSubjectType } from '#lib/utils/related-tasks.js';

export { CHIPS, byWhen, matchesChip, whenOf } from '#lib/utils/task-facts.js';
export type { Chip, ContractorMark, TaskFacts } from '#lib/utils/task-facts.js';

/**
 * The Tasks table's filters, chips and groups (#2625), all read from the URL so
 * a filtered view can be linked. Client-safe: no server imports.
 */

export const KINDS = ['timed', 'untimed', 'recurring', 'contractor'] as const;
export type Kind = (typeof KINDS)[number];

/** Days ahead a dated task may fall; overdue work is always inside. */
export const WINDOWS = [7, 30, 90] as const;
export type Window = (typeof WINDOWS)[number] | 'all';

export type Grouping = 'due' | 'project';

/** A record the table is narrowed to (#2630): `?about=<type>:<id>`. */
export interface About {
	type: RelatedSubjectType;
	id: string;
}

export interface TaskQuery {
	group: Grouping;
	days: Window;
	/** `''`, `'none'`, or a project's id. */
	project: string;
	role: string;
	kind: Kind | '';
	chip: Chip | '';
	done: boolean;
	about: About | null;
}

const pick = <T extends string>(list: readonly T[], raw: string | null): T | '' =>
	raw && (list as readonly string[]).includes(raw) ? (raw as T) : '';

/** `type:id` with a known type and an id; anything else is no filter. */
export function parseAbout(raw: string | null): About | null {
	const at = raw?.indexOf(':') ?? -1;
	if (!raw || at < 1 || at === raw.length - 1) return null;
	const type = pick(relatedSubjectTypes, raw.slice(0, at));
	return type ? { type, id: raw.slice(at + 1) } : null;
}

export const aboutParam = (a: About) => `${a.type}:${a.id}`;

export function parseTaskQuery(params: Pick<URLSearchParams, 'get'>): TaskQuery {
	const days = Number(params.get('days'));
	const project = params.get('project') ?? '';
	return {
		group: params.get('group') === 'project' ? 'project' : 'due',
		days: (WINDOWS as readonly number[]).includes(days) ? (days as Window) : 'all',
		project: project === 'none' || parseProjectFilter(project) === '' ? project : '',
		role: params.get('role') ?? '',
		kind: pick(KINDS, params.get('kind')),
		chip: pick(CHIPS, params.get('chip')),
		done: params.get('done') === '1',
		about: parseAbout(params.get('about'))
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
	if (q.about) pairs.push(['about', aboutParam(q.about)]);
	return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
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
