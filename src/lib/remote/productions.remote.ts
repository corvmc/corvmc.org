import { z } from 'zod';
import { form } from './_remote';
import { getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { addShowActContact } from '#lib/server/directory/contact-service.js';
import { createExternalAct } from '#lib/server/directory/entry-service.js';
import { performerFor } from '#lib/server/party/organization-service.js';
import { can, requireCapability } from '#lib/server/authorization.js';
import { requireProjectCommittee } from '#lib/server/group/group-context.js';
import { requireListingWriter } from '#lib/server/event/listing-guard.js';
import {
	projectOfArtifactRequest,
	projectOfEvent,
	projectOfExpense,
	projectOfProduction,
	projectOfSlot
} from '#lib/server/production/production-scope.js';
import { mapDomainError } from '#lib/server/errors.js';
import { recordStaffCount as recordStaffCountService } from '#lib/server/production/till-count-service.js';
import {
	recordPayouts as recordPayoutsService,
	recordSlotPayout,
	undoSlotPayout
} from '#lib/server/production/settlement-service.js';
import { addExpense, removeExpense } from '#lib/server/production/expense-service.js';
import { productionStatuses, type ProductionStatus } from '#lib/server/db/schema/production.js';
import {
	createProduction as createService,
	updateProductionDetails as updateService,
	transitionProduction as transitionService,
	reopenProduction as reopenService,
	markShowTiming,
	showStartsAt
} from '#lib/server/production/production-service.js';
import { addActToShow, removeActFromShow } from '#lib/server/production/lineup-service.js';
import { showClockTime } from '#lib/server/production/show-clock.js';
import {
	updateSlot,
	markSlotTiming as markTiming,
	moveSlot,
	setSlotTerms,
	buildSlotsFromLineup
} from '#lib/server/production/run-of-show-service.js';
import { openHostShift as openHost } from '#lib/server/production/host-service.js';
import { searchLeadCandidates } from '#lib/server/production/show-lead-service.js';
import {
	requestArtifact,
	cancelArtifactRequest,
	promotePosterArt
} from '#lib/server/production/artifact-request-service.js';
import { useArtWithFooter, useTemplateFlyer } from '#lib/server/poster/flyer-service.js';
import { PERCENTAGE_BPS_MAX } from '#lib/production/terms.js';
import { getStaffEventPage, getStaffEventProduction, getStaffEvents } from './events.remote';
import { getProjectDetail } from './projects.remote';
import { buildDateInTz, buildTimeRangeInTz } from '#lib/server/reservation/timezone.js';
import { create as createEventListing } from '#lib/server/event/event-service.js';
import { listAttachableListings } from '#lib/server/production/attachable-listings.js';
import { setRiderElementStock } from '#lib/server/production/rider-stock-service.js';
import {
	DEFAULT_TIMEZONE,
	SHORT_TEXT_MAX,
	productionExpenseCategories,
	requestableArtifacts
} from '#lib/config.js';
import { unaudited, writesAudit } from '#lib/server/audit/declared.js';

/**
 * Productions are guarded by what an action commits CMC to (#2959, decision
 * 0086). `production.book` is what binds CMC to someone outside it: the deal
 * terms, offering and confirming the lineup, cancelling, and naming the lead.
 * It is org-wide. `production.run` is the show's own work, with `'owned'` reach
 * for every committee on the show. The project is always read off the record
 * being written, never off the `eventId` a form carries for refreshing.
 */

/** Which capability moves a production to each status. */
const STATUS_OWNER: Record<ProductionStatus, 'production.book' | 'production.run'> = {
	draft: 'production.book',
	offered: 'production.book',
	confirmed: 'production.book',
	cancelled: 'production.book',
	completed: 'production.run',
	settled: 'production.run',
	closed: 'production.run'
};

export const createProduction = form(
	z.object({ eventId: z.string().min(1) }),
	async ({ eventId }) => {
		// No project exists until this runs, so the grant is org-wide: Booking
		// opens its own shows (#1675), and creation attaches Booking and Production.
		await requireCapability('production.create');
		const { locals } = getRequestEvent();
		try {
			const row = await createService(eventId, { createdByUserId: locals.user?.id });
			await Promise.all([
				getStaffEventPage(eventId).refresh(),
				getStaffEventProduction(eventId).refresh()
			]);
			return { id: row.id };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** The shows on the calendar "New production" can attach to, on the same guard. */
export const getAttachableListings = query(async () => {
	await requireCapability('production.create');
	return listAttachableListings();
});

/**
 * Open a show from nothing: a draft listing, its production, and its project
 * with Booking and Production attached. Guarded on `production.create` alone,
 * so Booking opens its own shows without the event pages' `event.read` (#1675).
 */
export const createShow = form(
	z.object({
		title: z.string().trim().min(1, 'Name the show').max(200),
		eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
		eventStartTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a start time'),
		eventEndTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick an end time')
	}),
	async ({ title, eventDate, eventStartTime, eventEndTime }) => {
		const user = await requireCapability('production.create');
		// An end before the start is a show that runs past midnight.
		const { startsAt, endsAt } = buildTimeRangeInTz(
			eventDate,
			eventStartTime,
			eventEndTime,
			DEFAULT_TIMEZONE
		);
		try {
			const row = await createEventListing({
				title,
				startsAt,
				endsAt,
				kind: 'show',
				groupId: null,
				createdByUserId: user.id,
				withProduction: true
			});
			return { eventId: row.id };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * The show's own settings on the Production tab (#3272): bands wanted, the
 * changeover, internal notes. Each is its own small form, so a key left out
 * is untouched rather than cleared.
 */
export const updateProduction = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		/**
		 * A string, not a number: an emptied number field is *dropped* from a
		 * remote `form()` payload, so a `z.number()` here could set a target and
		 * never clear one. Empty clears; absent is untouched.
		 */
		actsWanted: z
			.string()
			.regex(/^$|^([1-9]|1\d|20)$/, 'Pick a number of bands')
			.optional(),
		changeoverMinutes: z.number().int().min(0).max(240).optional(),
		internalNotes: z.string().max(2000).optional()
	}),
	async (data) => {
		await requireProjectCommittee(await projectOfProduction(data.id), 'production.run');
		try {
			await updateService(data.id, {
				actsWanted:
					data.actsWanted === undefined
						? undefined
						: data.actsWanted
							? Number(data.actsWanted)
							: null,
				changeoverMinutes: data.changeoverMinutes,
				internalNotes: data.internalNotes === undefined ? undefined : data.internalNotes || null
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** The run of show's fixed rows, in the order the night runs them. */
const showRows = ['loadIn', 'soundcheck', 'firstSet', 'curfew', 'loadOut'] as const;

/**
 * One time on the run of show. The date is the show's: a time is all a row
 * takes, and `showClockTime` puts one before 06:00 after midnight. Empty clears.
 */
export const setRunOfShowTime = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		row: z.enum(showRows),
		time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time')
	}),
	async (data) => {
		await requireProjectCommittee(await projectOfProduction(data.id), 'production.run');
		const startsAt = await showStartsAt(data.id);
		if (!startsAt) error(404, 'Production not found');
		const at = data.time ? showClockTime(startsAt, data.time) : null;
		const pick = (row: (typeof showRows)[number]) => (data.row === row ? at : undefined);
		try {
			await updateService(data.id, {
				loadInAt: pick('loadIn'),
				soundcheckAt: pick('soundcheck'),
				firstSetAt: pick('firstSet'),
				curfewAt: pick('curfew'),
				loadOutBy: pick('loadOut')
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** The fixed rows a Done records against. A set's Done is `markSlotTiming`. */
const doneRows = ['loadIn', 'soundcheck', 'doors', 'curfew', 'loadOut'] as const;

/**
 * Done on a fixed row of the run of show. `now` is taken server side, as for a
 * set, so a stale tab cannot stamp a time from ten minutes ago; `clear` undoes.
 */
export const markRunOfShowDone = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		row: z.enum(doneRows),
		action: z.enum(['now', 'clear'])
	}),
	async (data) => {
		await requireProjectCommittee(await projectOfProduction(data.id), 'production.run');
		const at = data.action === 'now' ? new Date() : null;
		const pick = (row: (typeof doneRows)[number]) => (data.row === row ? at : undefined);
		try {
			await markShowTiming(data.id, {
				loadInDoneAt: pick('loadIn'),
				soundcheckDoneAt: pick('soundcheck'),
				doorsDoneAt: pick('doors'),
				curfewDoneAt: pick('curfew'),
				loadOutDoneAt: pick('loadOut')
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** Who a show's booker may name as its lead: members, by name, on the same guard. */
export const searchShowLeadCandidates = query(
	z.object({ eventId: z.string().min(1), q: z.string().max(100) }),
	async ({ eventId, q }) => {
		await requireProjectCommittee(
			(await projectOfEvent(eventId))?.projectId ?? null,
			'production.book'
		);
		return searchLeadCandidates(q);
	}
);

/**
 * What a set actually ran to — Started and Finished on the running order.
 *
 * `now` is taken server side and the client sends only which end it is, so a
 * stale tab cannot stamp a time from ten minutes ago. `clear` is the
 * correction path a mistap needs: there is no other way back (#928).
 */
export const markSlotTiming = form(
	z.object({
		slotId: z.string().min(1),
		eventId: z.string().min(1),
		edge: z.enum(['start', 'end']),
		action: z.enum(['now', 'clear'])
	}),
	async (data) => {
		await requireProjectCommittee(await projectOfSlot(data.slotId), 'production.run');
		try {
			const value = data.action === 'now' ? new Date() : null;
			await markTiming(
				data.slotId,
				data.edge === 'start' ? { actualStartAt: value } : { actualEndAt: value }
			);
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * The staff count of the door cash, with the headcount and the split.
 *
 * An empty field clears back to null rather than writing a zero — "nobody
 * counted" and "counted nothing" are different states and the worksheet shows
 * them differently. `splitActsPercent` left blank means the house rule. Who
 * made the count is never refused: one person counting the whole till is a
 * warning on the settlement (#3273).
 *
 * Numbers, not strings: `MoneyField` carries cents in a hidden `n:` field so
 * nobody types 45 for a $45 door and records 45¢ (#929).
 */
export const recordStaffCount = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		doorCashCents: z.number().int().min(0).optional(),
		doorCount: z.number().int().min(0).optional(),
		splitActsPercent: z.number().int().min(0).max(100).optional()
	}),
	async (data) => {
		const { user } = await requireProjectCommittee(
			await projectOfProduction(data.id),
			'production.run'
		);
		try {
			// `undefined` is an empty box, not an untouched one: the form renders
			// every existing value into its field, so one that arrives missing is
			// one somebody cleared. That is what lets a door count go back to
			// "nobody counted" rather than being stuck at a number (#929).
			await recordStaffCountService(data.id, user.id, {
				cashCents: data.doorCashCents ?? null,
				count: data.doorCount ?? null,
				splitActsPercent: data.splitActsPercent ?? null
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * Open the host shift for a show.
 *
 * It creates the work order and stops — it does not put anybody on it. A host
 * is claimed through the volunteering pipeline like any other shift, which is
 * the whole reason for modelling it as one: the producer cannot assign
 * somebody their night from here, and a host who takes it gets the claim, the
 * confirmation and the hours that follow (#932).
 */
export const openHostShift = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	await requireProjectCommittee(
		(await projectOfEvent(data.eventId))?.projectId ?? null,
		'production.run'
	);
	try {
		await openHost(data.eventId);
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

/**
 * Move a show's status. Warn, record, allow
 * (docs/development/conventions.md#workflow-gates): a move with warnings comes
 * back unmoved as `{ conflict, warnings }`, which keeps the dialog open to show
 * them, and goes through once resubmitted acknowledged with a reason.
 */
export const advanceProduction = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		status: z.enum(productionStatuses),
		acknowledged: z.boolean().optional().default(false),
		reason: z.string().trim().max(500).optional()
	}),
	async (data) => {
		const { locals } = getRequestEvent();
		await requireProjectCommittee(await projectOfProduction(data.id), STATUS_OWNER[data.status]);
		try {
			const outcome = await transitionService(data.id, data.status, {
				actorUserId: locals.user?.id ?? null,
				acknowledged: data.acknowledged,
				reason: data.reason ?? null
			});
			if (!outcome.moved) return { conflict: true, warnings: outcome.warnings };
			await Promise.all([
				getStaffEventProduction(data.eventId).refresh(),
				// The index carries the status column now, so it goes stale here too.
				getStaffEvents({ source: 'cmc' }).refresh()
			]);
			return { success: true, warnings: outcome.warnings };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * Take a closed or cancelled show back. Admin-only: a terminal state is the
 * past, and leaving one is its own audited act rather than a status option.
 */
export const reopenProduction = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		status: z.enum(productionStatuses),
		reason: z.string().trim().min(1, 'Say why it is being reopened').max(500)
	}),
	async (data) => {
		await requireCapability('production.reopen');
		try {
			await reopenService(data.id, data.status, data.reason);
			await Promise.all([
				getStaffEventProduction(data.eventId).refresh(),
				getStaffEvents({ source: 'cmc' }).refresh()
			]);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

// ---------------------------------------------------------------------------
// Run of show
// ---------------------------------------------------------------------------

const slotRef = {
	eventId: z.string().min(1),
	slotId: z.string().min(1)
};

/** A set that runs longer than a working day is a typo, not a set. */
const setLength = z.number().int().min(1).max(600);

/** A set's length, from its lineup row. Every set after it moves. */
export const updateRunOfShowSlot = form(
	z.object({ ...slotRef, setLengthMinutes: setLength }),
	async (data) => {
		await requireProjectCommittee(await projectOfSlot(data.slotId), 'production.run');
		try {
			await updateSlot(data.slotId, { setLengthMinutes: data.setLengthMinutes });
		} catch (err) {
			mapDomainError(err);
		}
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	}
);

export const moveRunOfShowSlot = form(
	z.object({ ...slotRef, direction: z.enum(['up', 'down']) }),
	async (data) => {
		await requireProjectCommittee(await projectOfSlot(data.slotId), 'production.run');
		try {
			await moveSlot(data.slotId, data.direction);
		} catch (err) {
			mapDomainError(err);
		}
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	}
);

/** The production a listing announces, or a 404: the lineup needs one to hold sets. */
async function showOf(eventId: string) {
	const show = await projectOfEvent(eventId);
	if (!show?.productionId) error(404, 'Open a production first');
	return { projectId: show.projectId, productionId: show.productionId };
}

/**
 * Add an act to a CMC show's lineup (#3272): a CMC band, an outside act on
 * file, a new outside act, or a name only. Booking an act binds CMC to
 * someone outside it, so this is `production.book`, as the bill is.
 */
export const addLineupAct = form(
	z.object({
		eventId: z.string().min(1),
		name: z.string().trim().min(1, 'Name the act').max(200),
		bandId: z.string().max(100).optional(),
		actId: z.string().max(100).optional(),
		/** Save the name as a new outside act, with its hometown and contact. */
		newAct: z.boolean().optional().default(false),
		hometown: z.string().max(SHORT_TEXT_MAX).optional(),
		email: z.union([z.literal(''), z.email()]).optional(),
		setLengthMinutes: setLength
	}),
	async (data) => {
		await requireListingWriter(data.eventId, 'production.book');
		const show = await showOf(data.eventId);
		try {
			let actId = data.bandId ? undefined : data.actId || undefined;
			if (data.newAct && !data.bandId) {
				actId = await createExternalAct({ name: data.name, hometown: data.hometown || null });
				if (data.email) {
					await addShowActContact(await performerFor(actId), show.projectId, data.email);
				}
			}
			await addActToShow(
				data.eventId,
				show.productionId,
				{ name: data.name, bandId: data.bandId || undefined, actId },
				data.setLengthMinutes
			);
		} catch (err) {
			mapDomainError(err);
		}
		await Promise.all([
			getStaffEventProduction(data.eventId).refresh(),
			getStaffEventPage(data.eventId).refresh()
		]);
		return { success: true };
	}
);

/**
 * Take an act off the lineup: its credit, its claim on the show and its set.
 * `slotId` alone is a set with no credit, such as a DJ between bands.
 */
export const removeLineupAct = form(
	z.object({
		eventId: z.string().min(1),
		eventBandId: z.string().max(100).optional(),
		slotId: z.string().max(100).optional()
	}),
	unaudited(
		'A credit and its set on a show: planning content, not money or standing.',
		async (data) => {
			await requireListingWriter(data.eventId, 'production.book');
			const show = await showOf(data.eventId);
			if (!data.eventBandId && !data.slotId) error(400, 'Pick an act');
			try {
				await removeActFromShow(data.eventId, show.productionId, {
					eventBandId: data.eventBandId || undefined,
					slotId: data.slotId || undefined
				});
			} catch (err) {
				mapDomainError(err);
			}
			await Promise.all([
				getStaffEventProduction(data.eventId).refresh(),
				getStaffEventPage(data.eventId).refresh()
			]);
			return { success: true };
		}
	)
);

/** The empty state's one button: a bill is already a running order, usually. */
export const buildRunOfShowFromLineup = form(
	z.object({ eventId: z.string().min(1), productionId: z.string().min(1) }),
	async (data) => {
		// The lineup is read off `eventId`, so it must be the listing announcing this production.
		const listing = await projectOfEvent(data.eventId);
		if (listing?.productionId !== data.productionId) error(404, 'Production not found');
		await requireProjectCommittee(await projectOfProduction(data.productionId), 'production.run');
		try {
			await buildSlotsFromLineup(data.productionId, data.eventId);
		} catch (err) {
			mapDomainError(err);
		}
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	}
);

/**
 * The deal, per act.
 *
 * Its own form rather than fields on `updateRunOfShowSlot`: a money save and a
 * timing save want different confirmations, and this is the seam a settlement
 * capability would guard without splitting a form that had already grown.
 *
 * The ranges are here because they cannot be CHECK constraints — a CHECK on a
 * populated table is a rebuild — and because a client can post any number
 * regardless of what the column allows.
 */
export const setRunOfShowTerms = form(
	z.object({
		...slotRef,
		guaranteeCents: z.number().int().min(0).max(100_000_000).optional(),
		percentageBps: z.number().int().min(0).max(PERCENTAGE_BPS_MAX).optional(),
		versus: z.boolean().optional().default(false),
		againstNet: z.boolean().optional().default(false),
		contributed: z.boolean().optional().default(false)
	}),
	async (data) => {
		await requireProjectCommittee(await projectOfSlot(data.slotId), 'production.book');
		try {
			await setSlotTerms(data.slotId, {
				// A cleared number field is dropped from the payload rather than sent
				// as null, so the missing key is what "no guarantee" looks like.
				guaranteeCents: data.guaranteeCents ?? null,
				percentageBps: data.percentageBps ?? null,
				versus: data.versus,
				againstNet: data.againstNet,
				contributed: data.contributed
			});
		} catch (err) {
			mapDomainError(err);
		}
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	}
);

/** One act's line in the Settle dialog. A donated set records zero whatever the box says. */
const payoutLine = z
	.object({
		slotId: z.string().min(1),
		amountCents: z.number().int().min(0).max(100_000_000).optional(),
		donated: z.boolean().optional().default(false)
	})
	.refine((line) => line.donated || line.amountCents !== undefined, {
		message: 'Enter an amount',
		path: ['amountCents']
	});

/**
 * Every unpaid act's payout in one go, from the Settle dialog.
 *
 * `finance.refund` rather than a `production.*` half: the rest of the console
 * arranges a night, and this moves money out of the till and writes the ledger.
 * The production comes from the form only to say which one the slots must
 * belong to; the service refuses a slot of another production before writing any.
 */
export const recordPayouts = form(
	z.object({
		productionId: z.string().min(1),
		payouts: z.array(payoutLine).min(1).max(40)
	}),
	writesAudit('production.payout_recorded', async (data) => {
		const staff = await requireCapability('finance.refund');
		try {
			await recordPayoutsService(
				data.productionId,
				data.payouts.map((p) => ({
					slotId: p.slotId,
					amountCents: p.donated ? 0 : (p.amountCents ?? 0)
				})),
				staff.id
			);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	})
);

/**
 * A cost line shows on the console (`eventId`) and on the project's Budget page. The
 * project comes off the production, never the form, and only a reader of the page gets
 * its query refreshed: that query is guarded by `project.read`.
 */
async function refreshCosts(eventId: string | undefined, projectId: string | null) {
	if (eventId) await getStaffEventProduction(eventId).refresh();
	if (projectId && (await can('project.read'))) await getProjectDetail(projectId).refresh();
}

/**
 * What the night cost, line by line.
 *
 * `production.run`, not the payout's `finance.refund`: booking the engineer and
 * buying the hospitality is the producer's own work, and writing down what it
 * cost is part of it. Nothing leaves the till here — the line is a cost sheet
 * entry, and `deductible` is what an `againstNet` deal divides against.
 */
export const addProductionExpense = form(
	z.object({
		eventId: z.string().min(1).optional(),
		productionId: z.string().min(1),
		label: z.string().min(1).max(120),
		category: z.enum(productionExpenseCategories),
		amountCents: z.number().int().min(0).max(100_000_000),
		deductible: z.boolean().optional().default(true),
		paidTo: z.string().max(120).optional()
	}),
	async (data) => {
		const projectId = await projectOfProduction(data.productionId);
		const { user: staff } = await requireProjectCommittee(projectId, 'production.run');
		try {
			await addExpense({
				productionId: data.productionId,
				label: data.label,
				category: data.category,
				amountCents: data.amountCents,
				deductible: data.deductible,
				paidTo: data.paidTo?.trim() || null,
				recordedByUserId: staff.id
			});
		} catch (err) {
			mapDomainError(err);
		}
		await refreshCosts(data.eventId, projectId);
		return { success: true };
	}
);

/**
 * Take back a recorded payout, under the same `finance.refund` that recorded it.
 * The ledger gets reversing rows for this act alone; nothing is edited in place.
 */
export const undoActPayout = form(
	z.object(slotRef),
	writesAudit('production.payout_undone', async (data) => {
		await requireCapability('finance.refund');
		try {
			await undoSlotPayout(data.slotId);
		} catch (err) {
			mapDomainError(err);
		}
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	})
);

export const removeProductionExpense = form(
	z.object({ eventId: z.string().min(1).optional(), expenseId: z.string().min(1) }),
	writesAudit('production.expense_removed', async (data) => {
		const projectId = await projectOfExpense(data.expenseId);
		await requireProjectCommittee(projectId, 'production.run');
		try {
			await removeExpense(data.expenseId);
		} catch (err) {
			mapDomainError(err);
		}
		await refreshCosts(data.eventId, projectId);
		return { success: true };
	})
);

/**
 * Asking an act for a rider or a press kit, against a date.
 *
 * Guarded as the console it lives on: a request is against the event, so a
 * repeat ask is a reminder rather than a second row — `requestArtifact` upserts
 * on (event, act, artifact) and the outstanding count stays honest.
 */
export const askForArtifact = form(
	z.object({
		eventId: z.string().min(1),
		entryId: z.string().min(1),
		artifact: z.enum(requestableArtifacts),
		dueDate: z.string().optional()
	}),
	async (data) => {
		await requireProjectCommittee(
			(await projectOfEvent(data.eventId))?.projectId ?? null,
			'production.run'
		);
		const { locals } = getRequestEvent();
		try {
			await requestArtifact({
				eventId: data.eventId,
				entryId: data.entryId,
				artifact: data.artifact,
				dueAt: data.dueDate ? buildDateInTz(data.dueDate, '23:59', DEFAULT_TIMEZONE) : null,
				requestedByUserId: locals.user?.id ?? null
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** Match a rider item to a catalog item; an empty `itemId` clears the match. */
export const setRiderStock = form(
	z.object({
		eventId: z.string().min(1),
		elementId: z.string().min(1),
		itemId: z.string().optional()
	}),
	async (data) => {
		await requireProjectCommittee(
			(await projectOfEvent(data.eventId))?.projectId ?? null,
			'production.run'
		);
		try {
			await setRiderElementStock({
				eventId: data.eventId,
				elementId: data.elementId,
				itemId: data.itemId || null
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const dropArtifactRequest = form(
	z.object({ id: z.string().min(1), eventId: z.string().min(1) }),
	async (data) => {
		await requireProjectCommittee(await projectOfArtifactRequest(data.id), 'production.run');
		try {
			await cancelArtifactRequest(data.id);
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** Delivered art above a details footer, rendered and made the poster. */
export const usePosterArtWithFooter = form(
	z.object({ requestId: z.string().min(1), eventId: z.string().min(1) }),
	async (data) => {
		await requireProjectCommittee(await projectOfArtifactRequest(data.requestId), 'production.run');
		try {
			await useArtWithFooter(data.requestId);
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** The template flyer, rendered from the event's details, as its poster. A listing write. */
export const useTemplateFlyerAsPoster = form(
	z.object({ eventId: z.string().min(1) }),
	async (data) => {
		await requireListingWriter(data.eventId);
		try {
			await useTemplateFlyer(data.eventId);
			await Promise.all([
				getStaffEventPage(data.eventId).refresh(),
				getStaffEventProduction(data.eventId).refresh()
			]);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** Make delivered poster art the event's poster. The same object, re-pointed. */
export const usePosterArt = form(
	z.object({ requestId: z.string().min(1), eventId: z.string().min(1) }),
	async (data) => {
		await requireProjectCommittee(await projectOfArtifactRequest(data.requestId), 'production.run');
		try {
			await promotePosterArt(data.requestId);
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);
