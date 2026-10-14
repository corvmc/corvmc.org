import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { contractor, contractorJob } from '$lib/server/db/schema/contractor';
import { artifactRequest } from '$lib/server/db/schema/artifact-request';
import { volunteerSignup, workTask } from '$lib/server/db/schema/volunteer';
import { resolveImageUrl } from '$lib/server/storage';
import { chunk } from '$lib/server/utils/chunk';
import {
	contractorJobStatusesWithoutSpend,
	type ContractorJobStatus,
	type WorkDoneCondition
} from '$lib/config';
import {
	listRequests,
	requestableActsByEvent
} from '$lib/server/production/artifact-request-service';

/**
 * What the task list draws beside each row: the people on it, the contractor
 * engaged on it, its duties, and, for a derived task still open, what is
 * outstanding. One statement per kind over the whole list, never one per row.
 */

const IDS_PER_STATEMENT = 90;
const PEOPLE_STATUSES = ['claimed', 'confirmed', 'completed'] as const;

export interface TaskPerson {
	userId: string;
	name: string;
	image: string | null;
	status: (typeof PEOPLE_STATUSES)[number];
}

export interface TaskEngagement {
	id: string;
	contractorId: string;
	contractorName: string;
	status: ContractorJobStatus;
	quotedCents: number | null;
	costCents: number | null;
	isDonated: boolean;
	fairValueCents: number | null;
	invoiceRef: string | null;
	paidAt: Date | null;
	scheduledFor: Date | null;
}

export interface TaskDuty {
	id: string;
	label: string;
	done: boolean;
}

async function byChunks<T>(ids: string[], read: (group: string[]) => Promise<T[]>) {
	const unique = [...new Set(ids)];
	return (await Promise.all(chunk(unique, IDS_PER_STATEMENT).map(read))).flat();
}

function group<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
	const out = new Map<K, T[]>();
	for (const r of rows) {
		const list = out.get(key(r)) ?? [];
		list.push(r);
		out.set(key(r), list);
	}
	return out;
}

export async function peopleOn(ids: string[]): Promise<Map<string, TaskPerson[]>> {
	const rows = await byChunks(ids, (g) =>
		db
			.select({
				shiftId: volunteerSignup.shiftId,
				userId: user.id,
				name: user.name,
				image: user.image,
				status: volunteerSignup.status
			})
			.from(volunteerSignup)
			.innerJoin(user, eq(user.id, volunteerSignup.userId))
			.where(
				and(
					inArray(volunteerSignup.shiftId, g),
					inArray(volunteerSignup.status, [...PEOPLE_STATUSES])
				)
			)
			.orderBy(asc(volunteerSignup.createdAt), asc(volunteerSignup.id))
	);
	const people = rows.map((r) => ({
		shiftId: r.shiftId,
		userId: r.userId,
		name: r.name,
		image: resolveImageUrl(r.image),
		status: r.status as TaskPerson['status']
	}));
	return new Map(
		[...group(people, (p) => p.shiftId)].map(([id, list]) => [
			id,
			list.map(({ shiftId: _, ...p }) => p)
		])
	);
}

/**
 * The engagement a row shows: the live one if there is one, else the latest,
 * so a declined quote still reads as such until somebody is asked again.
 */
export async function engagementsOn(ids: string[]): Promise<Map<string, TaskEngagement>> {
	const rows = await byChunks(ids, (g) =>
		db
			.select({
				workOrderId: contractorJob.workOrderId,
				id: contractorJob.id,
				contractorId: contractor.id,
				contractorName: contractor.name,
				status: contractorJob.status,
				quotedCents: contractorJob.quotedCents,
				costCents: contractorJob.costCents,
				isDonated: contractorJob.isDonated,
				fairValueCents: contractorJob.fairValueCents,
				invoiceRef: contractorJob.invoiceRef,
				paidAt: contractorJob.paidAt,
				scheduledFor: contractorJob.scheduledFor,
				createdAt: contractorJob.createdAt
			})
			.from(contractorJob)
			.innerJoin(contractor, eq(contractor.id, contractorJob.contractorId))
			.where(inArray(contractorJob.workOrderId, g))
			.orderBy(desc(contractorJob.createdAt), desc(contractorJob.id))
	);
	const dead = new Set<string>(contractorJobStatusesWithoutSpend);
	const out = new Map<string, TaskEngagement>();
	for (const [id, list] of group(rows, (r) => r.workOrderId)) {
		const {
			workOrderId: _w,
			createdAt: _c,
			...pick
		} = list.find((r) => !dead.has(r.status)) ?? list[0];
		out.set(id, pick);
	}
	return out;
}

export async function dutiesOn(ids: string[]): Promise<Map<string, TaskDuty[]>> {
	const rows = await byChunks(ids, (g) =>
		db
			.select({
				workOrderId: workTask.workOrderId,
				id: workTask.id,
				label: workTask.label,
				done: workTask.done
			})
			.from(workTask)
			.where(inArray(workTask.workOrderId, g))
			.orderBy(asc(workTask.sortOrder), asc(workTask.createdAt), asc(workTask.id))
	);
	return new Map(
		[...group(rows, (r) => r.workOrderId)].map(([id, list]) => [
			id,
			list.map(({ workOrderId: _, ...d }) => d)
		])
	);
}

/** What a derived task is still waiting on, for the panel. */
export type Outstanding =
	| {
			kind: 'acts';
			eventId: string;
			notAsked: { entryId: string; name: string }[];
			awaiting: { requestId: string; actName: string | null; artifact: string }[];
	  }
	| { kind: 'listing'; eventId: string }
	| { kind: 'production'; eventId: string }
	| { kind: 'crew'; taskIds: string[] }
	| { kind: 'duties' }
	| { kind: 'no_show' };

interface OutstandingInput {
	id: string;
	eventId: string | null;
	doneWhen: WorkDoneCondition | null;
	state: string;
	volunteerRoleId: string | null;
	capacity: number;
	claimed: number;
}

const LISTING: readonly WorkDoneCondition[] = ['poster_set', 'description_set', 'event_published'];

/**
 * Outstanding items for each open derived task. Acts are read per show, and
 * a show list has one or two shows, so this stays a handful of statements.
 */
export async function outstandingFor(
	tasks: readonly OutstandingInput[]
): Promise<Map<string, Outstanding>> {
	const out = new Map<string, Outstanding>();
	const pending = tasks.filter((t) => t.doneWhen && t.state !== 'done' && t.state !== 'cancelled');
	const askEvents = [
		...new Set(
			pending.filter((t) => t.doneWhen === 'artifacts_requested').flatMap((t) => t.eventId ?? [])
		)
	];
	const [acts, asks, requests] = await Promise.all([
		requestableActsByEvent(askEvents),
		askEvents.length
			? db
					.select({ eventId: artifactRequest.eventId, entryId: artifactRequest.entryId })
					.from(artifactRequest)
					.where(
						and(inArray(artifactRequest.eventId, askEvents), isNull(artifactRequest.cancelledAt))
					)
			: Promise.resolve([]),
		Promise.all(askEvents.map(async (id) => [id, await listRequests(id)] as const))
	]);
	const asked = new Set(asks.map((a) => `${a.eventId}:${a.entryId}`));
	const requestsBy = new Map(requests);

	for (const t of pending) {
		const when = t.doneWhen!;
		if (when === 'tasks_ticked') out.set(t.id, { kind: 'duties' });
		else if (!t.eventId) out.set(t.id, { kind: 'no_show' });
		else if (LISTING.includes(when)) out.set(t.id, { kind: 'listing', eventId: t.eventId });
		else if (when === 'artifacts_requested') {
			const eventId = t.eventId;
			out.set(t.id, {
				kind: 'acts',
				eventId,
				notAsked: (acts.get(eventId) ?? []).filter((a) => !asked.has(`${eventId}:${a.entryId}`)),
				awaiting: (requestsBy.get(eventId) ?? [])
					.filter((r) => !r.fulfilled)
					.map((r) => ({ requestId: r.id, actName: r.actName, artifact: r.artifact }))
			});
		} else if (when === 'shifts_filled') {
			const short = tasks.filter(
				(o) =>
					o.eventId === t.eventId &&
					o.volunteerRoleId !== null &&
					o.state !== 'cancelled' &&
					o.claimed < o.capacity
			);
			out.set(t.id, { kind: 'crew', taskIds: short.map((o) => o.id) });
		} else out.set(t.id, { kind: 'production', eventId: t.eventId });
	}
	return out;
}
