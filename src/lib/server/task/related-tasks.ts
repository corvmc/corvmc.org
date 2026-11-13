import { db } from '#lib/server/db/index.js';
import { workOrder } from '#lib/server/db/schema/volunteer.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { projectCommittee } from '#lib/server/db/schema/project.js';
import { contractorJob } from '#lib/server/db/schema/contractor.js';
import { grantApplication } from '#lib/server/db/schema/grant.js';
import { sponsorship } from '#lib/server/db/schema/sponsor.js';
import { and, desc, eq, inArray, isNull, ne, not, or, sql, type SQL } from 'drizzle-orm';
import { linkedTo, type LinkTarget, type LinkTo } from './work-order-link';
import { taskRowQuery, toTaskRow } from '#lib/server/volunteer/task-catalogue.js';
import type { LinkSubjectType, RelatedSubjectType, RelationKey } from '#lib/utils/related-tasks.js';
import type { TaskRow } from '#lib/utils/task-facts.js';

export type { RelatedSubjectType, RelationKey };

/**
 * How a record finds its tasks (#2630): one resolver per subject type, each
 * returning its relations closest first. A relation is a condition on
 * `work_order` that an index answers; the later ones exclude what an earlier
 * one already claims, so a task appears once, under its closest relation.
 */

export interface RelatedSubject {
	type: RelatedSubjectType;
	id: string;
}

export interface Relation {
	key: RelationKey;
	where: SQL;
}

type Resolver = (id: string) => Relation[];

const otherThan = (column: typeof workOrder.eventId | typeof workOrder.groupId, id: string) =>
	or(isNull(column), ne(column, id)) as SQL;

const resolvers: Partial<Record<RelatedSubjectType, Resolver>> = {
	event: (id) => {
		// The show is the listing's project; another night of it is on that project too.
		const show = sql`(select ${eventListing.projectId} from ${eventListing} where ${eventListing.id} = ${id})`;
		const nights = db
			.select({ id: eventListing.id })
			.from(eventListing)
			.where(eq(eventListing.projectId, show));
		return [
			{ key: 'event', where: eq(workOrder.eventId, id) },
			{
				key: 'show',
				where: and(
					or(eq(workOrder.projectId, show), inArray(workOrder.eventId, nights)),
					otherThan(workOrder.eventId, id)
				) as SQL
			}
		];
	},
	project: (id) => [{ key: 'project', where: eq(workOrder.projectId, id) }],
	group: (id) => {
		const owned = db
			.select({ id: projectCommittee.projectId })
			.from(projectCommittee)
			.where(eq(projectCommittee.groupId, id));
		return [
			{ key: 'group', where: eq(workOrder.groupId, id) },
			{
				key: 'groupProjects',
				where: and(inArray(workOrder.projectId, owned), otherThan(workOrder.groupId, id)) as SQL
			}
		];
	},
	role: (id) => [{ key: 'role', where: eq(workOrder.volunteerRoleId, id) }],
	recurring_work: (id) => [
		{ key: 'recurringWork', where: eq(workOrder.maintenanceScheduleId, id) }
	],
	organization: (id) => {
		const about = linkedTo('organizationId', id);
		const jobs = db
			.select({ id: contractorJob.workOrderId })
			.from(contractorJob)
			.where(eq(contractorJob.organizationId, id));
		// The follow-ups on its grants and sponsorships are tasks on their projects.
		const funding = db
			.select({ id: grantApplication.projectId })
			.from(grantApplication)
			.where(eq(grantApplication.organizationId, id))
			.union(
				db
					.select({ id: sponsorship.projectId })
					.from(sponsorship)
					.where(eq(sponsorship.organizationId, id))
			);
		const onJob = inArray(workOrder.id, jobs);
		return [
			{ key: 'about', where: about },
			{ key: 'contractorJobs', where: and(onJob, not(about)) as SQL },
			{
				key: 'funding',
				where: and(inArray(workOrder.projectId, funding), not(about), not(onJob)) as SQL
			}
		];
	},
	contact: (id) => [{ key: 'about', where: linkedTo('contactId', id) }],
	asset: (id) => [{ key: 'about', where: linkedTo('assetId', id) }],
	reservation: (id) => [{ key: 'about', where: linkedTo('reservationId', id) }]
};

/** The `work_order_link` column each linkable record type writes. */
export const LINK_TARGET: Record<LinkSubjectType, LinkTarget> = {
	organization: 'organizationId',
	contact: 'contactId',
	asset: 'assetId',
	reservation: 'reservationId'
};

const isLinkSubject = (type: RelatedSubjectType): type is LinkSubjectType => type in LINK_TARGET;

/** The link a new task about this record writes. */
export function linkFor(subject: { type: LinkSubjectType; id: string }): LinkTo {
	return { [LINK_TARGET[subject.type]]: subject.id };
}

/** The types that resolve to anything; every other type has no related tasks. */
export const resolvingTypes = Object.keys(resolvers) as RelatedSubjectType[];

export function relationsFor(subject: RelatedSubject): Relation[] {
	return resolvers[subject.type]?.(subject.id) ?? [];
}

/** Every relation at once, for the Tasks table's `?about=`; null when none resolve. */
export function relatedTaskWhere(subject: RelatedSubject): SQL | null {
	const all = relationsFor(subject);
	return all.length === 0 ? null : (or(...all.map((r) => r.where)) as SQL);
}

/** `?about=` as a filter: a type that resolves to nothing matches nothing. */
export const aboutWhere = (subject: RelatedSubject): SQL => relatedTaskWhere(subject) ?? sql`0 = 1`;

/** What New task fills in from the record; null where the record makes no tasks by hand. */
export interface NewTaskPrefill {
	projectId?: string;
	eventId?: string;
	groupId?: string;
	volunteerRoleId?: string;
	/** A `work_order_link` row to the record itself. */
	about?: { type: LinkSubjectType; id: string };
}

export async function newTaskPrefill(subject: RelatedSubject): Promise<NewTaskPrefill | null> {
	switch (subject.type) {
		case 'event': {
			const [row] = await db
				.select({ projectId: eventListing.projectId })
				.from(eventListing)
				.where(eq(eventListing.id, subject.id))
				.limit(1);
			return { eventId: subject.id, ...(row?.projectId ? { projectId: row.projectId } : {}) };
		}
		case 'project':
			return { projectId: subject.id };
		case 'group':
			return { groupId: subject.id };
		case 'role':
			return { volunteerRoleId: subject.id };
		default:
			return isLinkSubject(subject.type) ? { about: { type: subject.type, id: subject.id } } : null;
	}
}

export interface RelatedGroup {
	key: RelationKey;
	tasks: TaskRow[];
	/** More matched than the limit let through. */
	more: boolean;
}

export interface RelatedTaskOptions {
	limitPerRelation?: number;
	/** Done tasks are left out unless asked for. Called-off ones always are. */
	includeDone?: boolean;
	/** A further condition on every relation: the tasks this viewer may see. */
	where?: SQL;
	now?: Date;
}

/**
 * Each relation as one limited query, merged closest first. Empty relations are
 * dropped. The caller has already decided the viewer may read tasks.
 */
export async function relatedTasks(
	subject: RelatedSubject,
	{ limitPerRelation = 20, includeDone = false, where, now = new Date() }: RelatedTaskOptions = {}
): Promise<RelatedGroup[]> {
	const relations = relationsFor(subject);
	const results = await Promise.all(
		relations.map((r) =>
			taskRowQuery(now)
				.where(
					and(
						r.where,
						where,
						isNull(workOrder.cancelledAt),
						includeDone ? undefined : isNull(workOrder.resolvedAt)
					)
				)
				.orderBy(
					sql`${workOrder.resolvedAt} is not null`,
					desc(workOrder.createdAt),
					desc(workOrder.id)
				)
				.limit(limitPerRelation + 1)
		)
	);
	const seen = new Set<string>();
	const groups: RelatedGroup[] = [];
	relations.forEach((r, i) => {
		const rows = results[i];
		const tasks = rows
			.slice(0, limitPerRelation)
			.filter((t) => !seen.has(t.id))
			.map(toTaskRow);
		for (const t of tasks) seen.add(t.id);
		if (tasks.length > 0) groups.push({ key: r.key, tasks, more: rows.length > limitPerRelation });
	});
	return groups;
}
