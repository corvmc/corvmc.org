import type { TaskList } from './task-view';

/**
 * Where a move puts a task, in the shape `moveTaskCommand` takes: a section
 * (null is the unlabelled group) and an index among that section's other tasks.
 * Positions count every task in a section, whatever the filter hides, because
 * that is what the server renumbers.
 */
export interface TaskSlot {
	sectionId: string | null;
	index: number;
}

/** Section keys in display order: the unlabelled group first. */
function sectionKeys(list: Pick<TaskList, 'sections'>): (string | null)[] {
	return [null, ...list.sections.map((s) => s.id)];
}

/** Each section's task ids in their order. `list.tasks` is already sorted by position. */
export function tasksBySection(list: Pick<TaskList, 'sections' | 'tasks'>) {
	const known = new Set(list.sections.map((s) => s.id));
	const out = new Map<string | null, string[]>(sectionKeys(list).map((k) => [k, []]));
	for (const t of list.tasks) {
		const key = t.sectionId && known.has(t.sectionId) ? t.sectionId : null;
		out.get(key)!.push(t.id);
	}
	return out;
}

/**
 * One step up or down for the keyboard. Past the top or bottom of a section
 * it crosses into the neighbouring one; past the ends of the list it stays.
 */
export function stepTask(
	list: Pick<TaskList, 'sections' | 'tasks'>,
	taskId: string,
	delta: -1 | 1
): TaskSlot | null {
	const by = tasksBySection(list);
	const keys = sectionKeys(list);
	const at = keys.findIndex((k) => by.get(k)!.includes(taskId));
	if (at < 0) return null;
	const ids = by.get(keys[at])!;
	const index = ids.indexOf(taskId);
	const next = index + delta;
	if (next >= 0 && next < ids.length) return { sectionId: keys[at], index: next };
	const neighbour = at + delta;
	if (neighbour < 0 || neighbour >= keys.length) return null;
	const target = keys[neighbour];
	return { sectionId: target, index: delta < 0 ? by.get(target)!.length : 0 };
}

/** Where dropping on a row (before it) or on a section's heading (its top) lands. */
export function dropSlot(
	list: Pick<TaskList, 'sections' | 'tasks'>,
	taskId: string,
	target: { sectionId: string | null; beforeId: string | null }
): TaskSlot {
	const others = (tasksBySection(list).get(target.sectionId) ?? []).filter((id) => id !== taskId);
	const index = target.beforeId ? others.indexOf(target.beforeId) : 0;
	return { sectionId: target.sectionId, index: index < 0 ? others.length : index };
}

/** The section order after moving one, or null when it would not move. */
export function stepSection(ids: string[], sectionId: string, delta: -1 | 1): string[] | null {
	const at = ids.indexOf(sectionId);
	const to = at + delta;
	if (at < 0 || to < 0 || to >= ids.length) return null;
	const next = [...ids];
	[next[at], next[to]] = [next[to], next[at]];
	return next;
}

/** The section order after dropping one before another. */
export function dropSection(ids: string[], sectionId: string, beforeId: string): string[] | null {
	if (sectionId === beforeId || !ids.includes(sectionId)) return null;
	const rest = ids.filter((id) => id !== sectionId);
	const at = rest.indexOf(beforeId);
	if (at < 0) return null;
	rest.splice(at, 0, sectionId);
	return rest;
}
