import { entityTypes } from '#lib/config.js';

/**
 * What `RelatedTasks` can be given (#2630): any entity type, plus the two
 * records with task relations that `EntityType` does not name. `recurring` is
 * a recurring reservation; `recurring_work` is a maintenance schedule.
 * Client-safe: no server imports.
 */
export const relatedSubjectTypes = [...entityTypes, 'group', 'recurring_work'] as const;
export type RelatedSubjectType = (typeof relatedSubjectTypes)[number];

/** A relation's name, closest first within each subject type. */
export const relationKeys = [
	'event',
	'show',
	'project',
	'group',
	'groupProjects',
	'role',
	'recurringWork'
] as const;
export type RelationKey = (typeof relationKeys)[number];
