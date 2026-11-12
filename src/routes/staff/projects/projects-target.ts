/**
 * Projects became a view of Tasks (#2625). Every old address lands in one hop:
 * the list on the table grouped by project, a project's task on its own page,
 * and the rest of a project under `/staff/tasks/projects`.
 */
export function projectsTarget(rest: string, search: string): string {
	const parts = rest.split('/').filter(Boolean);
	if (parts.length === 0) return '/staff/tasks?group=project';
	const [head, ...tail] = parts;
	if (head === 'productions' || head === 'templates') {
		return `/staff/tasks/${parts.join('/')}${search}`;
	}
	if (tail[0] === 'tasks' && tail[1]) return `/staff/tasks/${tail[1]}`;
	return `/staff/tasks/projects/${parts.join('/')}${search}`;
}
