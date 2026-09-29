import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { eventListing } from '$lib/server/db/schema/event';
import { production } from '$lib/server/db/schema/production';
import { workTask } from '$lib/server/db/schema/volunteer';
import { eventPosterKeySql } from '$lib/server/event/event-columns';
import {
	hasDescription,
	hasPoster,
	isProductionConfirmed,
	isProductionSettled
} from '$lib/server/event/show-readiness';
import { eventsWithEveryActAsked } from '$lib/server/production/artifact-request-service';
import { productionsOwingCloseOut } from '$lib/server/production/production-service';
import type { WorkDoneCondition } from '$lib/config';
import { eventsShortOfCrew } from './work-order-service';

/**
 * When a committee's work order is done (docs/specs/committee-deliverables-spec.md §2).
 *
 * Each `done_when` names a fact about the work order's show, evaluated here by
 * a typed function over a batch of shows. Nothing is stored when a fact comes
 * true, so an item goes back to open if the fact goes away. Deliverables never
 * gate anything: the publish and `closed` gates read the same facts directly.
 */

export type DeliverableState = 'cancelled' | 'done' | 'overdue' | 'open';

export interface DoneInput {
	id: string;
	eventId: string | null;
	doneWhen: WorkDoneCondition | null;
	resolvedAt: Date | null;
	cancelledAt: Date | null;
	dueAt: Date | null;
}

/** One show's listing and production, read once per batch for the conditions that need it. */
interface ShowFacts {
	productionId: string | null;
	productionStatus: string | null;
	listingStatus: string;
	posterKey: string | null;
	description: string | null;
}

type Holds = (
	eventIds: string[],
	facts: () => Promise<Map<string, ShowFacts>>
) => Promise<Set<string>>;

/** `facts` filtered by a predicate on one show's row. */
const byFact =
	(test: (f: ShowFacts) => boolean): Holds =>
	async (eventIds, facts) => {
		const all = await facts();
		return new Set(
			eventIds.filter((id) => {
				const f = all.get(id);
				return f !== undefined && test(f);
			})
		);
	};

/** Adding a condition is one entry in `workDoneConditions` and one here. */
const registry: Record<Exclude<WorkDoneCondition, 'tasks_ticked'>, Holds> = {
	production_confirmed: byFact((f) => isProductionConfirmed(f.productionStatus)),
	production_settled: byFact((f) => isProductionSettled(f.productionStatus)),
	poster_set: byFact((f) => hasPoster(f.posterKey)),
	description_set: byFact((f) => hasDescription(f.description)),
	event_published: byFact((f) => f.listingStatus === 'published'),
	artifacts_requested: (eventIds) => eventsWithEveryActAsked(eventIds),
	shifts_filled: async (eventIds) => {
		const short = await eventsShortOfCrew(eventIds);
		return new Set(eventIds.filter((id) => !short.has(id)));
	},
	close_out_done: async (eventIds, facts) => {
		const all = await facts();
		const productions = eventIds.flatMap((id) => all.get(id)?.productionId ?? []);
		const owing = await productionsOwingCloseOut(productions);
		return new Set(
			eventIds.filter((id) => {
				const p = all.get(id)?.productionId;
				return p != null && !owing.has(p);
			})
		);
	}
};

async function loadShowFacts(eventIds: string[]): Promise<Map<string, ShowFacts>> {
	const rows = await db
		.select({
			eventId: eventListing.id,
			productionId: production.id,
			productionStatus: production.status,
			listingStatus: eventListing.status,
			posterKey: eventPosterKeySql,
			description: eventListing.description
		})
		.from(eventListing)
		.leftJoin(production, eq(production.id, eventListing.productionId))
		.where(inArray(eventListing.id, eventIds));
	return new Map(rows.map(({ eventId, ...f }) => [eventId, f]));
}

/** Work orders among these with a task still unticked. */
async function withOpenTasks(workOrderIds: string[]): Promise<Set<string>> {
	if (workOrderIds.length === 0) return new Set();
	const rows = await db
		.selectDistinct({ id: workTask.workOrderId })
		.from(workTask)
		.where(and(inArray(workTask.workOrderId, workOrderIds), eq(workTask.done, false)));
	return new Set(rows.map((r) => r.id));
}

/**
 * The derived state of each work order: one query per condition kind in use,
 * plus the tasks and the shared listing read, however many items there are.
 */
export async function evaluateDone(
	rows: readonly DoneInput[],
	now = new Date()
): Promise<Map<string, DeliverableState>> {
	const pending = rows.filter((r) => !r.cancelledAt && !r.resolvedAt && r.doneWhen);

	let cached: Promise<Map<string, ShowFacts>> | null = null;
	const facts = (ids: string[]) => () => (cached ??= loadShowFacts(ids));
	const allEvents = [...new Set(pending.flatMap((r) => r.eventId ?? []))];

	const holding = new Map<WorkDoneCondition, Set<string>>();
	const kinds = [...new Set(pending.map((r) => r.doneWhen!))];
	await Promise.all(
		kinds.map(async (kind) => {
			if (kind === 'tasks_ticked') return;
			const events = [
				...new Set(pending.filter((r) => r.doneWhen === kind).flatMap((r) => r.eventId ?? []))
			];
			holding.set(kind, events.length ? await registry[kind](events, facts(allEvents)) : new Set());
		})
	);
	const unticked = await withOpenTasks(pending.map((r) => r.id));

	const state = new Map<string, DeliverableState>();
	for (const r of rows) {
		if (r.cancelledAt) state.set(r.id, 'cancelled');
		else if (r.resolvedAt || conditionHolds(r, holding, unticked)) state.set(r.id, 'done');
		else if (r.dueAt && r.dueAt < now) state.set(r.id, 'overdue');
		else state.set(r.id, 'open');
	}
	return state;
}

function conditionHolds(
	r: DoneInput,
	holding: Map<WorkDoneCondition, Set<string>>,
	unticked: Set<string>
): boolean {
	if (!r.doneWhen || unticked.has(r.id)) return false;
	if (r.doneWhen === 'tasks_ticked') return true;
	return r.eventId !== null && (holding.get(r.doneWhen)?.has(r.eventId) ?? false);
}
