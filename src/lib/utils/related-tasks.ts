import { entityTypes } from '#lib/config.js';

/**
 * What `RelatedTasks` can be given (#2630): any entity type, plus the records
 * with task relations that `EntityType` does not name. `recurring` is a
 * recurring reservation; `recurring_work` is a maintenance schedule.
 * Client-safe: no server imports.
 */
export const relatedSubjectTypes = [...entityTypes, 'group', 'recurring_work'] as const;
export type RelatedSubjectType = (typeof relatedSubjectTypes)[number];

/** Records a task is about through `work_order_link` (#2622). */
export const linkSubjectTypes = [
	'organization',
	'contact',
	'asset',
	'reservation',
	'equipment'
] as const;
export type LinkSubjectType = (typeof linkSubjectTypes)[number];

/** A relation's name, closest first within each subject type. */
export const relationKeys = [
	'event',
	'show',
	'project',
	'group',
	'groupProjects',
	'role',
	'recurringWork',
	'about',
	'contractorJobs',
	'funding'
] as const;
export type RelationKey = (typeof relationKeys)[number];
