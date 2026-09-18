import { z } from 'zod';
import { form } from './_remote';
import { getRequestEvent } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { recordSlotPayout } from '$lib/server/production/settlement-service';
import { addExpense, removeExpense } from '$lib/server/production/expense-service';
import { productionStatuses } from '$lib/server/db/schema/production';
import {
	createProduction as createService,
	updateProductionDetails as updateService,
	transitionProduction as transitionService
} from '$lib/server/production/production-service';
import {
	addSlot,
	updateSlot,
	markSlotTiming as markTiming,
	moveSlot,
	removeSlot,
	setSlotTerms,
	buildSlotsFromLineup
} from '$lib/server/production/run-of-show-service';
import { openHostShift as openHost } from '$lib/server/production/host-service';
import {
	requestArtifact,
	cancelArtifactRequest
} from '$lib/server/production/artifact-request-service';
import { PERCENTAGE_BPS_MAX } from '$lib/production/terms';
import { getStaffEventPage, getStaffEventProduction, getStaffEvents } from './events.remote';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE, productionExpenseCategories, requestableArtifacts } from '$lib/config';

/**
 * Productions are guarded as events, not on a `production.*` set of their own.
 *
 * A production is the ops half of one show, and the person who decides its
 * load-in is the person who manages the show — the same argument the venue
 * remotes carry, and a stronger one here, because a production cannot exist
 * without the listing it hangs off. A capability exists when a guard names it;
 * a `production` resource would be one no position's job description mentions,
 * and `config.spec.ts` would accept it only because `staffCapabilities` is
 * derived, which is a technicality rather than a real holder.
 *
 * The one visible consequence: `volunteer_coordinator` holds `event.read` and
 * can therefore read a production. That is already true of the whole console —
 * the advance work lives there — and it is correct.
 */

/** A cleared datetime-local field arrives as '' rather than null. */
function optionalMoment(date?: string, time?: string): Date | null {
	if (!date || !time) return null;
	return buildDateInTz(date, time, DEFAULT_TIMEZONE);
}

const momentFields = {
	loadInDate: z.string().optional(),
	loadInTime: z.string().optional(),
	soundcheckDate: z.string().optional(),
	soundcheckTime: z.string().optional(),
	firstSetDate: z.string().optional(),
	firstSetTime: z.string().optional(),
	curfewDate: z.string().optional(),
	curfewTime: z.string().optional(),
	loadOutDate: z.string().optional(),
	loadOutTime: z.string().optional()
};

export const createProduction = form(
	z.object({ eventId: z.string().min(1) }),
	async ({ eventId }) => {
		await requireCapability('event.manage');
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

export const updateProduction = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		/**
		 * A string, not a number: an emptied number field is *dropped* from a
		 * remote `form()` payload, so a `z.number()` here could set a target and
		 * never clear one. The `<select>` posts `''` for "not set", which is the
		 * clear, and absent still means untouched.
		 */
		actsWanted: z
			.string()
			.regex(/^$|^([1-9]|1\d|20)$/, 'Pick a number of acts')
			.optional(),
		billingNotes: z.string().max(2000).optional(),
		hospitalityNotes: z.string().max(2000).optional(),
		internalNotes: z.string().max(2000).optional(),
		...momentFields
	}),
	async (data) => {
		await requireCapability('event.manage');
		try {
			await updateService(data.id, {
				loadInAt: optionalMoment(data.loadInDate, data.loadInTime),
				soundcheckAt: optionalMoment(data.soundcheckDate, data.soundcheckTime),
				firstSetAt: optionalMoment(data.firstSetDate, data.firstSetTime),
				curfewAt: optionalMoment(data.curfewDate, data.curfewTime),
				loadOutBy: optionalMoment(data.loadOutDate, data.loadOutTime),
				actsWanted:
					data.actsWanted === undefined
						? undefined
						: data.actsWanted
							? Number(data.actsWanted)
							: null,
				billingNotes: data.billingNotes || null,
				hospitalityNotes: data.hospitalityNotes || null,
				internalNotes: data.internalNotes || null
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * Who is running the night, as a claim rather than a picker.
 *
 * There is no `production_lead` in the capability matrix, so there is no list
 * of candidates a picker could offer that would mean anything — and the useful
 * question on the day is whether anybody has taken it. `'me'` resolves server
 * side: the client never names a user id, so this cannot be used to assign
 * somebody else their work.
 */
export const setProductionProducer = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		producer: z.enum(['me', 'none'])
	}),
	async (data) => {
		await requireCapability('event.manage');
		const { locals } = getRequestEvent();
		try {
			await updateService(data.id, {
				producerUserId: data.producer === 'me' ? (locals.user?.id ?? null) : null
			});
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
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
		await requireCapability('event.manage');
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
 * The drawer count at the end of the night.
 *
 * An empty field clears back to null rather than writing a zero — "nobody
 * counted" and "counted nothing" are different states and the worksheet shows
 * them differently. `splitActsPercent` left blank means the house rule.
 *
 * Numbers, not strings: `MoneyField` carries cents in a hidden `n:` field so
 * nobody types 45 for a $45 door and records 45¢ (#929).
 */
export const recordDoorTake = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		doorCashCents: z.number().int().min(0).optional(),
		doorCount: z.number().int().min(0).optional(),
		splitActsPercent: z.number().int().min(0).max(100).optional()
	}),
	async (data) => {
		await requireCapability('event.manage');
		try {
			// `undefined` is an empty box, not an untouched one: the form renders
			// every existing value into its field, so one that arrives missing is
			// one somebody cleared. That is what lets a door count go back to
			// "nobody counted" rather than being stuck at a number (#929).
			await updateService(data.id, {
				doorCashCents: data.doorCashCents ?? null,
				doorCount: data.doorCount ?? null,
				doorSplitActsPercent: data.splitActsPercent ?? null
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
	await requireCapability('event.manage');
	try {
		await openHost(data.eventId);
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const advanceProduction = form(
	z.object({
		id: z.string().min(1),
		eventId: z.string().min(1),
		status: z.enum(productionStatuses)
	}),
	async (data) => {
		const { locals } = getRequestEvent();
		await requireCapability('event.manage');
		try {
			await transitionService(data.id, data.status, locals.user?.id ?? null);
			await Promise.all([
				getStaffEventProduction(data.eventId).refresh(),
				// The index carries the status column now, so it goes stale here too.
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
const changeover = z.number().int().min(0).max(240);

/** Turn '' into null once, so a handler never has to decide what blank means. */
function optionalText(value?: string): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export const addRunOfShowSlot = form(
	z.object({
		eventId: z.string().min(1),
		productionId: z.string().min(1),
		/** Blank is a slot on no poster — a DJ between sets, a host. */
		eventBandId: z.string().optional(),
		setLengthMinutes: setLength,
		changeoverMinutes: changeover.optional()
	}),
	async (data) => {
		await requireCapability('event.manage');
		try {
			await addSlot(data.productionId, {
				eventBandId: data.eventBandId || null,
				setLengthMinutes: data.setLengthMinutes,
				changeoverMinutes: data.changeoverMinutes
			});
		} catch (err) {
			mapDomainError(err);
		}
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	}
);

export const updateRunOfShowSlot = form(
	z.object({
		...slotRef,
		setLengthMinutes: setLength,
		changeoverMinutes: changeover,
		soundcheckDate: z.string().optional(),
		soundcheckTime: z.string().optional(),
		techNotes: z.string().max(2000).optional(),
		backlineNeeds: z.string().max(2000).optional(),
		hospitalityNotes: z.string().max(2000).optional(),
		contactName: z.string().max(200).optional(),
		contactEmail: z.string().max(200).optional(),
		contactPhone: z.string().max(50).optional()
	}),
	async (data) => {
		await requireCapability('event.manage');
		try {
			await updateSlot(data.slotId, {
				setLengthMinutes: data.setLengthMinutes,
				changeoverMinutes: data.changeoverMinutes,
				soundcheckAt: optionalMoment(data.soundcheckDate, data.soundcheckTime),
				techNotes: optionalText(data.techNotes),
				backlineNeeds: optionalText(data.backlineNeeds),
				hospitalityNotes: optionalText(data.hospitalityNotes),
				contactName: optionalText(data.contactName),
				contactEmail: optionalText(data.contactEmail),
				contactPhone: optionalText(data.contactPhone)
			});
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
		await requireCapability('event.manage');
		try {
			await moveSlot(data.slotId, data.direction);
		} catch (err) {
			mapDomainError(err);
		}
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	}
);

export const removeRunOfShowSlot = form(z.object(slotRef), async (data) => {
	await requireCapability('event.manage');
	try {
		await removeSlot(data.slotId);
	} catch (err) {
		mapDomainError(err);
	}
	await getStaffEventProduction(data.eventId).refresh();
	return { success: true };
});

/** The empty state's one button: a bill is already a running order, usually. */
export const buildRunOfShowFromLineup = form(
	z.object({ eventId: z.string().min(1), productionId: z.string().min(1) }),
	async (data) => {
		await requireCapability('event.manage');
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
		await requireCapability('event.manage');
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

/**
 * What an act was actually handed.
 *
 * `finance.refund` rather than `event.manage`, which every other control on
 * this console uses: the rest of the page arranges a night, and this one moves
 * money out of the till and writes the ledger. A producer runs the show; a
 * treasurer says what was paid.
 */
export const recordActPayout = form(
	z.object({
		...slotRef,
		amountCents: z.number().int().min(0).max(100_000_000)
	}),
	async (data) => {
		const staff = await requireCapability('finance.refund');
		try {
			await recordSlotPayout(data.slotId, data.amountCents, staff.id);
		} catch (err) {
			mapDomainError(err);
		}
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	}
);

/**
 * What the night cost, line by line.
 *
 * `event.manage`, not the payout's `finance.refund`: booking the engineer and
 * buying the hospitality is the producer's own work, and writing down what it
 * cost is part of it. Nothing leaves the till here — the line is a cost sheet
 * entry, and `deductible` is what an `againstNet` deal divides against.
 */
export const addProductionExpense = form(
	z.object({
		eventId: z.string().min(1),
		productionId: z.string().min(1),
		label: z.string().min(1).max(120),
		category: z.enum(productionExpenseCategories),
		amountCents: z.number().int().min(0).max(100_000_000),
		deductible: z.boolean().optional().default(true),
		paidTo: z.string().max(120).optional()
	}),
	async (data) => {
		const staff = await requireCapability('event.manage');
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
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	}
);

export const removeProductionExpense = form(
	z.object({ eventId: z.string().min(1), expenseId: z.string().min(1) }),
	async (data) => {
		await requireCapability('event.manage');
		try {
			await removeExpense(data.expenseId);
		} catch (err) {
			mapDomainError(err);
		}
		await getStaffEventProduction(data.eventId).refresh();
		return { success: true };
	}
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
		await requireCapability('event.manage');
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

export const dropArtifactRequest = form(
	z.object({ id: z.string().min(1), eventId: z.string().min(1) }),
	async (data) => {
		await requireCapability('event.manage');
		try {
			await cancelArtifactRequest(data.id);
			await getStaffEventProduction(data.eventId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);
