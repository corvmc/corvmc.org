/**
 * The Operations committee's fixed rows (#2992): the group, its listing, and
 * one position per job. Pure and imported by relative path, so the dev seed
 * (which wipes the migration's copy) writes exactly what production has.
 */
import { jobs, positionLabels, OPERATIONS_GROUP_ID, type Job } from '../../config';

export const OPERATIONS_NAME = 'Operations';

/** The chair seat's job. The chair position is named Chair, like every committee's. */
export const OPERATIONS_CHAIR_JOB = 'operations_chair' satisfies Job;

export const operationsGroupRow = {
	id: OPERATIONS_GROUP_ID,
	kind: 'committee' as const,
	name: OPERATIONS_NAME,
	slug: 'operations',
	joinPolicy: 'invite_only' as const
};

export const operationsEntryRow = {
	id: OPERATIONS_GROUP_ID,
	groupId: OPERATIONS_GROUP_ID,
	name: OPERATIONS_NAME,
	visibility: 'members' as const
};

export function operationsPositionId(job: Job): string {
	return `operations-${job}`;
}

export function operationsPositionRows() {
	return jobs.map((job) => ({
		id: operationsPositionId(job),
		groupId: OPERATIONS_GROUP_ID,
		name: job === OPERATIONS_CHAIR_JOB ? 'Chair' : positionLabels[job],
		isChair: job === OPERATIONS_CHAIR_JOB,
		job
	}));
}
