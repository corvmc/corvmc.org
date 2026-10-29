/** Work in a project, or work in none: orientation, recurring and one-off shifts. */
export const PROJECT_FILTERS = {
	'': 'Any project',
	project: 'In a project',
	none: 'No project'
} as const;
export type ProjectFilter = keyof typeof PROJECT_FILTERS;

export const parseProjectFilter = (raw: string | null): ProjectFilter =>
	raw && raw in PROJECT_FILTERS ? (raw as ProjectFilter) : '';

export function matchesProject(w: { projectId: string | null }, filter: ProjectFilter): boolean {
	if (filter === 'project') return w.projectId !== null;
	if (filter === 'none') return w.projectId === null;
	return true;
}
