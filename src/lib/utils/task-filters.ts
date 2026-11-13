import { CHIPS, whenOf, type Chip, type ContractorMark, type TaskFacts } from './task-facts';
import { relatedSubjectTypes, type RelatedSubjectType } from './related-tasks';

export { CHIPS, byWhen, matchesChip, whenOf } from './task-facts';
export type { Chip, ContractorMark, TaskFacts } from './task-facts';

/**
 * The Tasks table's filters, chips and groups (#2625), all read from the URL so
 * a filtered view can be linked. Client-safe: no server imports.
 */

export const KINDS = ['timed', 'untimed', 'recurring', 'contractor'] as const;
export type Kind = (typeof KINDS)[number];

/** Days ahead a dated task may fall; overdue work is always inside. */
export const WINDOWS = [7, 30, 90] as const;
export type Window = (typeof WINDOWS)[number] | 'all';

export const GROUPINGS = ['due', 'project', 'section'] as const;
export type Grouping = (typeof GROUPINGS)[number];

/** A record the table is narrowed to (#2630): `?about=<type>:<id>`. */
export interface About {
	type: RelatedSubjectType;
	id: string;
}

export interface TaskQuery {
	/** `''` is the page's own default: Section on a project with sections, else Due. */
	group: Grouping | '';
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
		group: pick(GROUPINGS, params.get('group')),
		days: (WINDOWS as readonly number[]).includes(days) ? (days as Window) : 'all',
		// `project` was the Schedule's "in a project" value; Tasks groups by project instead.
		project: project === 'project' ? '' : project,
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
	if (q.group) pairs.push(['group', q.group]);
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
	if (filter === '') return true;
	if (filter === 'none') return t.projectId === null;
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

/**
 * The grouping a table shows. Section only on one project's list, and by
 * default there once the project has sections; Project only across projects.
 */
export function effectiveGrouping(
	group: Grouping | '',
	on: { project: boolean; sections: number }
): Grouping {
	if (on.project) {
		if (group === 'section' || (group === '' && on.sections > 0)) return 'section';
		return 'due';
	}
	return group === 'project' ? 'project' : 'due';
}

/**
 * Each section in its order, then the tasks in none. `keepEmpty` keeps a
 * section with nothing in it, so it can still be renamed or added to.
 */
export function groupBySection<T extends { sectionId: string | null }>(
	sections: readonly { id: string; name: string }[],
	rows: T[],
	keepEmpty = false
): { section: { id: string; name: string } | null; rows: T[] }[] {
	const known = new Set(sections.map((s) => s.id));
	const groups = sections.map((section) => ({
		section,
		rows: rows.filter((r) => r.sectionId === section.id)
	}));
	const loose = rows.filter((r) => r.sectionId === null || !known.has(r.sectionId));
	return [
		...groups.filter((g) => keepEmpty || g.rows.length > 0),
		...(loose.length > 0 ? [{ section: null, rows: loose }] : [])
	];
}
