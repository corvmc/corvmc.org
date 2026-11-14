import * as env from '$app/env/public';
import { db } from '#lib/server/db/index.js';
import { and, asc, desc, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { eventListing, publicEventStatuses } from '#lib/server/db/schema/event.js';
import { projectCommittee } from '#lib/server/db/schema/project.js';
import { marketDay, marketVendor, type MarketVendor } from '#lib/server/db/schema/market.js';
import { organization, vendorDetail } from '#lib/server/db/schema/party.js';
import { recordApplicantUnguarded } from '#lib/server/directory/contact-service.js';
import { fileThread } from '#lib/server/party/thread-filing.js';
import { findOrCreateThread } from '#lib/server/inbox/thread-service.js';
import {
	addInboundMessage,
	announceQueuedReply,
	queuedReplyStatements
} from '#lib/server/inbox/message-service.js';
import { DomainError } from '#lib/server/domain-error.js';
import {
	latestDeliveries,
	latestDelivery,
	retryNow,
	type Delivery
} from '#lib/server/outbox/outbox-service.js';
import {
	marketVendorDecisions,
	marketVendorStatuses,
	type MarketVendorStatus
} from '#lib/config.js';
import {
	refundVendorFee,
	vendorFeeColumns,
	vendorPayPath,
	withFeeState
} from './vendor-fee-service';
import { addressVendorThread, vendorRecipients } from './vendor-recipient';

/**
 * Vendor applications for a market day CMC hosts. docs/development/business-workflows.md §19.
 *
 * Unguarded: the remote layer guards. A vendor is an organization holding
 * `vendor`; its people are `contact` rows, never columns on `market_vendor`, so
 * the public list below cannot leak one however it is later reshaped. The
 * inbox thread each application opens is the conversation.
 */

export class MarketClosedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This market is not taking vendor applications.');
	}
}

export class VendorNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Vendor application not found.');
	}
}

export class VendorTransitionError extends DomainError {
	readonly httpStatus = 409;
	constructor(from: MarketVendorStatus, to: string) {
		super(`A ${from} application cannot become ${to}.`);
	}
}

/**
 * Where a decision or withdrawal may move each status. `withdrawn` is the
 * vendor's call and is final. `no_show` moves only through `markVendorNoShow`.
 * `waitlisted` holds a vendor in reserve until a table frees up (#2832).
 */
const transitions: Record<MarketVendorStatus, readonly MarketVendorStatus[]> = {
	applied: ['accepted', 'waitlisted', 'declined', 'withdrawn'],
	waitlisted: ['accepted', 'declined', 'withdrawn'],
	accepted: ['declined', 'withdrawn'],
	declined: ['accepted', 'withdrawn'],
	withdrawn: [],
	no_show: []
};

export interface MarketSetup {
	applicationsCloseAt: Date | null;
	tableCount: number | null;
	/** Per table. Left out, an existing market keeps its fee and a new one is free. */
	tableFeeCents?: number;
	slidingScale?: boolean;
	slidingScaleFloorCents?: number;
}

function accepting(
	event: { status: string; startsAt: Date },
	closesAt: Date | null,
	now: Date
): boolean {
	if (event.status !== 'published') return false;
	if (now >= event.startsAt) return false;
	return !closesAt || now < closesAt;
}

/** Make a listing a market, or change its setup. Idempotent. */
export async function openMarketDay(eventId: string, setup: MarketSetup): Promise<void> {
	await db
		.insert(marketDay)
		.values({ eventId, ...setup })
		.onConflictDoUpdate({
			target: marketDay.eventId,
			set: { ...setup, updatedAt: new Date() }
		});
	await db
		.update(eventListing)
		.set({ kind: 'market', updatedAt: new Date() })
		.where(eq(eventListing.id, eventId));
}

async function loadMarket(eventId: string) {
	const [row] = await db
		.select({
			eventId: marketDay.eventId,
			applicationsCloseAt: marketDay.applicationsCloseAt,
			tableCount: marketDay.tableCount,
			tableFeeCents: marketDay.tableFeeCents,
			slidingScale: marketDay.slidingScale,
			slidingScaleFloorCents: marketDay.slidingScaleFloorCents,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			status: eventListing.status
		})
		.from(marketDay)
		.innerJoin(eventListing, eq(eventListing.id, marketDay.eventId))
		.where(eq(marketDay.eventId, eventId))
		.limit(1);
	return row ?? null;
}

/** The listing a vendors page hangs off, market or not yet. */
export async function getMarketEvent(eventId: string) {
	const [row] = await db
		.select({
			id: eventListing.id,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			status: eventListing.status,
			kind: eventListing.kind
		})
		.from(eventListing)
		.where(eq(eventListing.id, eventId))
		.limit(1);
	return row ?? null;
}

export type MarketVendorCounts = Record<MarketVendorStatus, number>;

/** The staff view of a market's setup, or null when the listing is not a market. */
export async function getMarketDay(eventId: string, now: Date = new Date()) {
	const market = await loadMarket(eventId);
	if (!market) return null;

	const rows = await db
		.select({ status: marketVendor.status, n: sql<number>`count(*)` })
		.from(marketVendor)
		.where(eq(marketVendor.eventId, eventId))
		.groupBy(marketVendor.status);
	const counts = Object.fromEntries(marketVendorStatuses.map((s) => [s, 0])) as MarketVendorCounts;
	for (const r of rows) counts[r.status] = Number(r.n);

	return {
		eventId,
		applicationsCloseAt: market.applicationsCloseAt,
		tableCount: market.tableCount,
		tableFeeCents: market.tableFeeCents,
		slidingScale: market.slidingScale,
		slidingScaleFloorCents: market.slidingScaleFloorCents,
		accepting: accepting(market, market.applicationsCloseAt, now),
		counts
	};
}

/** What the public application page needs. Null unless the market is public. */
export async function getApplicationWindow(eventId: string, now: Date = new Date()) {
	const market = await loadMarket(eventId);
	if (!market || !(publicEventStatuses as readonly string[]).includes(market.status)) return null;
	return {
		eventId,
		title: market.title,
		startsAt: market.startsAt,
		closesAt: market.applicationsCloseAt,
		accepting: accepting(market, market.applicationsCloseAt, now)
	};
}

export interface VendorApplicationInput {
	contactName: string;
	contactEmail: string;
	contactPhone?: string | null;
	businessName: string;
	offering: string;
	website?: string | null;
	tablesRequested: number;
	needsPower: boolean;
	bringsOwnTable?: boolean;
	bringsTent?: boolean;
	notes?: string | null;
}

function applicationBody(input: VendorApplicationInput, title: string): string {
	const lines = [
		`Market: ${title}`,
		`Business: ${input.businessName}`,
		`Sells: ${input.offering}`,
		input.website ? `Website: ${input.website}` : null,
		`Tables: ${input.tablesRequested}${input.needsPower ? ', needs power' : ''}`,
		input.bringsOwnTable ? 'Brings own table' : null,
		input.bringsTent ? 'Brings a tent' : null,
		input.contactPhone ? `Phone: ${input.contactPhone}` : null
	].filter(Boolean);
	return input.notes ? `${lines.join('\n')}\n\n---\n\n${input.notes}` : lines.join('\n');
}

/**
 * File a vendor's application, opening the inbox thread staff answer it on.
 *
 * The thread comes first: an application with no conversation is one staff
 * cannot reply to, while an orphan thread is still a readable enquiry.
 */
export async function submitApplication(
	eventId: string,
	input: VendorApplicationInput,
	now: Date = new Date()
): Promise<{ id: string }> {
	const window = await getApplicationWindow(eventId, now);
	if (!window?.accepting) throw new MarketClosedError();

	const thread = await findOrCreateThread({
		channel: 'web',
		contactName: input.contactName,
		contactEmail: input.contactEmail,
		contactPhone: input.contactPhone || null,
		subject: `Vendor application: ${input.businessName} — ${window.title}`
	});
	await addInboundMessage({
		threadId: thread.id,
		body: applicationBody(input, window.title),
		authorName: input.contactName
	});

	// The business: found through a contact already holding the email, else new.
	const { organizationId } = await recordApplicantUnguarded({
		organizationName: input.businessName,
		role: 'vendor',
		name: input.contactName,
		email: input.contactEmail,
		phone: input.contactPhone
	});
	await fileThread(thread.id, { type: 'organization', id: organizationId });
	const standing = await standingNeeds(organizationId, input);

	const [row] = await db
		.insert(marketVendor)
		.values({
			eventId,
			threadId: thread.id,
			organizationId,
			businessName: input.businessName,
			offering: input.offering,
			website: input.website || standing.website,
			tablesRequested: input.tablesRequested,
			needsPower: input.needsPower,
			bringsOwnTable: input.bringsOwnTable ?? false,
			bringsTent: input.bringsTent ?? false,
			notes: input.notes || standing.setupNotes
		})
		.returning({ id: marketVendor.id });
	return row;
}

/**
 * A returning vendor's standing needs fill what the form left blank, and a
 * first application writes them. Later ones never overwrite them: staff keep
 * `vendor_detail` on the organization page. The public form shows none of it,
 * since anyone can type a vendor's email.
 */
async function standingNeeds(organizationId: string, input: VendorApplicationInput) {
	const [[detail], [org]] = await Promise.all([
		db.select().from(vendorDetail).where(eq(vendorDetail.organizationId, organizationId)).limit(1),
		db
			.select({ website: organization.website })
			.from(organization)
			.where(eq(organization.id, organizationId))
			.limit(1)
	]);
	if (!detail) {
		// Keyed by organization: a concurrent first application writes it once.
		await db
			.insert(vendorDetail)
			.values({
				organizationId,
				offering: input.offering,
				tablesNeeded: input.tablesRequested,
				needsPower: input.needsPower,
				bringsOwnTable: input.bringsOwnTable ?? false,
				bringsTent: input.bringsTent ?? false,
				setupNotes: input.notes || null
			})
			.onConflictDoNothing();
	}
	if (!org?.website && input.website) {
		await db
			.update(organization)
			.set({ website: input.website, updatedAt: new Date() })
			.where(eq(organization.id, organizationId));
	}
	return { website: org?.website ?? null, setupNotes: detail?.setupNotes ?? null };
}

/**
 * Every application for a market, with the contact joined from its thread.
 * Staff only. A business that applied twice is kept twice (warn, record,
 * allow), and each row names the other ones in `alsoApplied`.
 */
export async function listApplications(eventId: string) {
	const rows = await db
		.select({
			id: marketVendor.id,
			threadId: marketVendor.threadId,
			businessName: marketVendor.businessName,
			offering: marketVendor.offering,
			website: marketVendor.website,
			organizationId: marketVendor.organizationId,
			tablesRequested: marketVendor.tablesRequested,
			needsPower: marketVendor.needsPower,
			bringsOwnTable: marketVendor.bringsOwnTable,
			bringsTent: marketVendor.bringsTent,
			notes: marketVendor.notes,
			status: marketVendor.status,
			tableLabel: marketVendor.tableLabel,
			decidedByUserId: marketVendor.decidedByUserId,
			decidedAt: marketVendor.decidedAt,
			...vendorFeeColumns,
			createdAt: marketVendor.createdAt
		})
		.from(marketVendor)
		.where(eq(marketVendor.eventId, eventId))
		.orderBy(asc(marketVendor.createdAt), asc(marketVendor.businessName));
	const [previous, told, recipients] = await Promise.all([
		previousRecords(
			eventId,
			rows.map((r) => r.organizationId)
		),
		latestDeliveries(
			vendorDecisionSubject('').type,
			rows.map((r) => r.id)
		),
		vendorRecipients(rows)
	]);
	return rows.map((r) => {
		const to = recipients.get(r.id)!;
		return {
			...withFeeState(r),
			contactName: to.name,
			contactEmail: to.email,
			contactPhone: to.phone,
			/** `application` when the organization has no contact with an email (#2830). */
			contactSource: to.source,
			/** Whether the decision message reached the vendor; null when none was sent (#2819). */
			decisionMessage: told.get(r.id) ?? null,
			previous: (r.organizationId && previous.get(r.organizationId)) || null,
			alsoApplied: r.organizationId
				? rows
						.filter((o) => o.id !== r.id && o.organizationId === r.organizationId)
						.map(({ id, status, tableLabel }) => ({ id, status, tableLabel }))
				: []
		};
	});
}

export interface PreviousMarketRecord {
	eventTitle: string;
	startsAt: Date;
	status: MarketVendorStatus;
	inviteBack: boolean;
	note: string | null;
}

/**
 * The newest invite-back record from an earlier market, per vendor
 * organization (#1505, #2622). A vendor who applies from a new address still
 * matches once staff merge the two organizations.
 */
async function previousRecords(
	eventId: string,
	organizationIds: (string | null)[]
): Promise<Map<string, PreviousMarketRecord>> {
	const wanted = [...new Set(organizationIds.filter((o): o is string => !!o))];
	const found = new Map<string, PreviousMarketRecord>();
	if (wanted.length === 0) return found;

	const [current] = await db
		.select({ startsAt: eventListing.startsAt })
		.from(eventListing)
		.where(eq(eventListing.id, eventId))
		.limit(1);
	if (!current) return found;

	const rows = await db
		.select({
			organizationId: marketVendor.organizationId,
			eventTitle: eventListing.title,
			startsAt: eventListing.startsAt,
			status: marketVendor.status,
			inviteBack: marketVendor.inviteBack,
			note: marketVendor.inviteBackNote
		})
		.from(marketVendor)
		.innerJoin(eventListing, eq(eventListing.id, marketVendor.eventId))
		.where(
			and(
				ne(marketVendor.eventId, eventId),
				isNotNull(marketVendor.inviteBack),
				lt(eventListing.startsAt, current.startsAt),
				inArray(marketVendor.organizationId, wanted)
			)
		)
		.orderBy(desc(eventListing.startsAt), desc(marketVendor.id));
	for (const { organizationId: key, inviteBack, ...rest } of rows) {
		if (key && !found.has(key)) found.set(key, { ...rest, inviteBack: inviteBack === true });
	}
	return found;
}

/**
 * The day-of list: accepted vendors and no-shows, by table then name, with
 * what each still owes. No contact detail, so the owning committee can work
 * the door with it.
 */
export async function listMarketDayVendors(eventId: string) {
	const rows = await db
		.select({
			id: marketVendor.id,
			businessName: marketVendor.businessName,
			offering: marketVendor.offering,
			tablesRequested: marketVendor.tablesRequested,
			needsPower: marketVendor.needsPower,
			bringsOwnTable: marketVendor.bringsOwnTable,
			bringsTent: marketVendor.bringsTent,
			status: marketVendor.status,
			tableLabel: marketVendor.tableLabel,
			checkedInAt: marketVendor.checkedInAt,
			inviteBack: marketVendor.inviteBack,
			inviteBackNote: marketVendor.inviteBackNote,
			...vendorFeeColumns
		})
		.from(marketVendor)
		.where(
			and(eq(marketVendor.eventId, eventId), inArray(marketVendor.status, ['accepted', 'no_show']))
		)
		.orderBy(asc(marketVendor.tableLabel), asc(marketVendor.businessName));
	return rows.map(withFeeState);
}

export type MarketDayVendor = Awaited<ReturnType<typeof listMarketDayVendors>>[number];

/** Mark an accepted vendor arrived, or undo it. */
export async function checkInVendor(
	vendorId: string,
	arrived: boolean,
	now: Date = new Date()
): Promise<{ eventId: string }> {
	const vendor = await loadVendor(vendorId);
	if (vendor.status !== 'accepted') throw new VendorTransitionError(vendor.status, 'checked in');
	await db
		.update(marketVendor)
		.set({ checkedInAt: arrived ? now : null, updatedAt: new Date() })
		.where(eq(marketVendor.id, vendorId));
	return { eventId: vendor.eventId };
}

/** An accepted vendor who never arrived, or the correction back to accepted. */
export async function markVendorNoShow(
	vendorId: string,
	noShow: boolean
): Promise<{ eventId: string }> {
	const vendor = await loadVendor(vendorId);
	const [from, to] = noShow
		? (['accepted', 'no_show'] as const)
		: (['no_show', 'accepted'] as const);
	if (vendor.status !== from || (noShow && vendor.checkedInAt)) {
		throw new VendorTransitionError(vendor.status, to);
	}
	await db
		.update(marketVendor)
		.set({ status: to, updatedAt: new Date() })
		.where(eq(marketVendor.id, vendorId));
	return { eventId: vendor.eventId };
}

/** Whether to ask this vendor again, for a vendor who was booked for the day. */
export async function recordInviteBack(
	vendorId: string,
	record: { inviteBack: boolean; note: string }
): Promise<{ eventId: string }> {
	const vendor = await loadVendor(vendorId);
	if (vendor.status !== 'accepted' && vendor.status !== 'no_show') {
		throw new VendorTransitionError(vendor.status, 'rated');
	}
	await db
		.update(marketVendor)
		.set({
			inviteBack: record.inviteBack,
			inviteBackNote: record.note.trim() || null,
			updatedAt: new Date()
		})
		.where(eq(marketVendor.id, vendorId));
	return { eventId: vendor.eventId };
}

export type VendorApplication = Awaited<ReturnType<typeof listApplications>>[number];

async function loadVendor(vendorId: string): Promise<MarketVendor> {
	const [row] = await db.select().from(marketVendor).where(eq(marketVendor.id, vendorId)).limit(1);
	if (!row) throw new VendorNotFoundError();
	return row;
}

function assertTransition(from: MarketVendorStatus, to: MarketVendorStatus) {
	if (!transitions[from].includes(to)) throw new VendorTransitionError(from, to);
}

export interface VendorDecision {
	decision: (typeof marketVendorDecisions)[number];
	tableLabel?: string | null;
	/** What the vendor is told, sent on their thread. */
	message: string;
}

/** What acceptance asks of a vendor: the market's per-table fee and floor, times their tables. */
async function feeOnAcceptance(vendor: MarketVendor) {
	const [day] = await db
		.select({
			fee: marketDay.tableFeeCents,
			sliding: marketDay.slidingScale,
			floor: marketDay.slidingScaleFloorCents
		})
		.from(marketDay)
		.where(eq(marketDay.eventId, vendor.eventId))
		.limit(1);
	const feeCents = (day?.fee ?? 0) * vendor.tablesRequested;
	const floor = day?.sliding ? Math.min(day.floor, day.fee) * vendor.tablesRequested : feeCents;
	// A refunded fee is spent; accepting again asks for it afresh.
	return {
		feeCents,
		feeFloorCents: floor,
		...(vendor.refundedAt
			? { paidCents: null, paidAt: null, stripePaymentRecordId: null, refundedAt: null }
			: {})
	};
}

/** The outbox subject a vendor's decision message is filed under. */
export const vendorDecisionSubject = (vendorId: string) => ({
	type: 'market_vendor',
	id: vendorId
});

/**
 * Accept, waitlist or decline, and tell the vendor. Accepting fixes the fee and adds the
 * pay link to the message; declining a vendor who paid refunds them first,
 * since CMC is the one cancelling (#1502). The decision and its message commit
 * together; the message is sent by the outbox, so a refused send leaves the
 * decision standing (#2819). `outboxId` is null when there was nothing to send.
 */
export async function decideApplication(
	vendorId: string,
	decision: VendorDecision,
	actor: { id: string; name: string }
): Promise<{ eventId: string; outboxId: string | null }> {
	const vendor = await loadVendor(vendorId);
	assertTransition(vendor.status, decision.decision);

	const accepted = decision.decision === 'accepted';
	const fee = accepted ? await feeOnAcceptance(vendor) : null;
	if (decision.decision === 'declined') await refundVendorFee(vendorId);

	const update = db
		.update(marketVendor)
		.set({
			status: decision.decision,
			tableLabel: accepted ? decision.tableLabel || null : null,
			decidedByUserId: actor.id,
			decidedAt: new Date(),
			updatedAt: new Date(),
			...fee
		})
		.where(eq(marketVendor.id, vendorId));

	const payLine =
		fee && fee.feeCents > 0
			? `\n\nPay your table fee here: ${env.PUBLIC_SITE_URL ?? 'https://corvmc.org'}${vendorPayPath(vendorId)}`
			: '';
	if (!vendor.threadId || !decision.message.trim()) {
		await update;
		return { eventId: vendor.eventId, outboxId: null };
	}

	const address = await addressVendorThread(vendor);
	const queued = await queuedReplyStatements({
		threadId: vendor.threadId,
		body: decision.message.trim() + payLine,
		authorUserId: actor.id,
		authorName: actor.name,
		subject: vendorDecisionSubject(vendorId)
	});
	await db.batch([update, ...address, ...queued.statements]);
	announceQueuedReply(queued, actor.id);
	return { eventId: vendor.eventId, outboxId: queued.outboxId };
}

/**
 * Send a decision message that did not reach the vendor, now (#2819). Null when
 * there is none to send: it went, or none was written.
 */
export async function resendDecisionMessage(vendorId: string): Promise<Delivery | null> {
	const latest = await latestDelivery(vendorDecisionSubject(vendorId));
	if (!latest || latest.status === 'sent') return null;
	// The contact may have changed since the decision; the resend follows it.
	for (const statement of await addressVendorThread(await loadVendor(vendorId))) await statement;
	return retryNow(latest.id);
}

/** A vendor's market, read off the row: what a guard on a vendor id checks against. */
export async function getVendorEventId(vendorId: string): Promise<string> {
	return (await loadVendor(vendorId)).eventId;
}

/**
 * The project a market day belongs to: its committees decide applications.
 * Null when the listing is on no project, which leaves the decision to staff
 * alone (#1503).
 */
export async function getMarketProjectId(eventId: string): Promise<string | null> {
	const [row] = await db
		.select({ projectId: eventListing.projectId })
		.from(eventListing)
		.where(eq(eventListing.id, eventId))
		.limit(1);
	return row?.projectId ?? null;
}

/** An application nobody has answered: the review feed's predicate. */
export const appliedVendor = () => eq(marketVendor.status, 'applied');

/** A committee's market days, soonest first, with how many applications wait on a decision. */
export async function listCommitteeMarkets(groupId: string) {
	const rows = await db
		.select({
			eventId: marketDay.eventId,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			toReview: sql<number>`(select count(*) from ${marketVendor} where ${marketVendor.eventId} = ${marketDay.eventId} and ${appliedVendor()})`
		})
		.from(marketDay)
		.innerJoin(eventListing, eq(eventListing.id, marketDay.eventId))
		.innerJoin(
			projectCommittee,
			and(
				eq(projectCommittee.projectId, eventListing.projectId),
				eq(projectCommittee.groupId, groupId)
			)
		)
		.orderBy(asc(eventListing.startsAt), asc(eventListing.id));
	return rows.map((r) => ({ ...r, toReview: Number(r.toReview) }));
}

/** Move an accepted vendor's table. */
export async function setTableLabel(
	vendorId: string,
	tableLabel: string | null
): Promise<{ eventId: string }> {
	const vendor = await loadVendor(vendorId);
	if (vendor.status !== 'accepted') throw new VendorTransitionError(vendor.status, 'reseated');
	await db
		.update(marketVendor)
		.set({ tableLabel: tableLabel || null, updatedAt: new Date() })
		.where(eq(marketVendor.id, vendorId));
	return { eventId: vendor.eventId };
}

/** The vendor pulled out, usually said on their thread. Final. */
export async function withdrawApplication(vendorId: string): Promise<{ eventId: string }> {
	const vendor = await loadVendor(vendorId);
	assertTransition(vendor.status, 'withdrawn');
	await db
		.update(marketVendor)
		.set({ status: 'withdrawn', tableLabel: null, updatedAt: new Date() })
		.where(eq(marketVendor.id, vendorId));
	return { eventId: vendor.eventId };
}

/** Accepted vendors, as the event page shows them. Columns named one by one. */
export async function listPublicVendors(eventId: string) {
	return db
		.select({
			businessName: marketVendor.businessName,
			offering: marketVendor.offering,
			website: marketVendor.website,
			tableLabel: marketVendor.tableLabel
		})
		.from(marketVendor)
		.where(and(eq(marketVendor.eventId, eventId), inArray(marketVendor.status, ['accepted'])))
		.orderBy(asc(marketVendor.businessName));
}

export type PublicVendor = Awaited<ReturnType<typeof listPublicVendors>>[number];
