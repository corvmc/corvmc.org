import { describe, it, expect } from 'vitest';
import { matchesProject, parseProjectFilter, PROJECT_FILTERS } from './project-filter';

/** The Schedule lists work with or without a project; this filter splits them (#2034). */
describe('the project filter', () => {
	const inProject = { projectId: 'p-1' };
	const loose = { projectId: null };

	it('keeps everything by default', () => {
		expect(matchesProject(inProject, '')).toBe(true);
		expect(matchesProject(loose, '')).toBe(true);
	});

	it('splits work in a project from work in none', () => {
		expect(matchesProject(inProject, 'project')).toBe(true);
		expect(matchesProject(loose, 'project')).toBe(false);
		expect(matchesProject(inProject, 'none')).toBe(false);
		expect(matchesProject(loose, 'none')).toBe(true);
	});

	it('reads the URL value, and falls back to everything', () => {
		expect(parseProjectFilter('none')).toBe('none');
		expect(parseProjectFilter('project')).toBe('project');
		expect(parseProjectFilter('bogus')).toBe('');
		expect(parseProjectFilter(null)).toBe('');
		expect(Object.keys(PROJECT_FILTERS)).toEqual(['', 'project', 'none']);
	});
});
