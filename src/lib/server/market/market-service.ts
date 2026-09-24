import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { and, asc, desc, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { eventListing, publicEventStatuses } from '$lib/server/db/schema/event';
import { inboxThread } from '$lib/server/db/schema/inbox';
import { project } from '$lib/server/db/schema/project';
import { marketDay, marketVendor, type MarketVendor } from '$lib/server/db/schema/market';
import { findOrCreateThread } from '$lib/server/inbox/thread-service';
import { addInboundMessage, addOutboundMessage } from '$lib/server/inbox/message-service';
import { DomainError } from '$lib/server/domain-error';
import { marketVendorStatuses, type MarketVendorStatus } from '$lib/config';
import { refundVendorFee, vendorPayPath } from './vendor-fee-service';

/**
 * Vendor applications for a market day CMC hosts. docs/specs/shipped/market-vendors-spec.md.
 *
 * Unguarded: the remote layer guards. The vendor's contact details live on the
 * inbox thread each application opens, never on `market_vendor`, so the public
 * list below cannot leak one however it is later reshaped.
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
 */
const transitions: Record<MarketVendorStatus, readonly MarketVendorStatus[]> = {
	applied: ['accepted', 'declined', 'withdrawn'],
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
	notes?: string | null;
}

function applicationBody(input: VendorApplicationInput, title: string): string {
	const lines = [
		`Market: ${title}`,
		`Business: ${input.businessName}`,
		`Sells: ${input.offering}`,
		input.website ? `Website: ${input.website}` : null,
		`Tables: ${input.tablesRequested}${input.needsPower ? ', needs power' : ''}`,
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

	const [row] = await db
		.insert(marketVendor)
		.values({
			eventId,
			threadId: thread.id,
			businessName: input.businessName,
			offering: input.offering,
			website: input.website || null,
			tablesRequested: input.tablesRequested,
			needsPower: input.needsPower,
			notes: input.notes || null
		})
		.returning({ id: marketVendor.id });
	return row;
}

/** Every application for a market, with the contact joined from its thread. Staff only. */
export async function listApplications(eventId: string) {
	const rows = await db
		.select({
			id: marketVendor.id,
			threadId: marketVendor.threadId,
			businessName: marketVendor.businessName,
			offering: marketVendor.offering,
			website: marketVendor.website,
			tablesRequested: marketVendor.tablesRequested,
			needsPower: marketVendor.needsPower,
			notes: marketVendor.notes,
			status: marketVendor.status,
			tableLabel: marketVendor.tableLabel,
			decidedByUserId: marketVendor.decidedByUserId,
			decidedAt: marketVendor.decidedAt,
			feeCents: marketVendor.feeCents,
			paidCents: marketVendor.paidCents,
			paidAt: marketVendor.paidAt,
			refundedAt: marketVendor.refundedAt,
			createdAt: marketVendor.createdAt,
			contactName: inboxThread.contactName,
			contactEmail: inboxThread.contactEmail,
			contactPhone: inboxThread.contactPhone
		})
		.from(marketVendor)
		.leftJoin(inboxThread, eq(inboxThread.id, marketVendor.threadId))
		.where(eq(marketVendor.eventId, eventId))
		.orderBy(asc(marketVendor.createdAt), asc(marketVendor.businessName));
	const previous = await previousRecords(
		eventId,
		rows.map((r) => r.contactEmail)
	);
	return rows.map((r) => ({
		...r,
		previous: (r.contactEmail && previous.get(r.contactEmail.toLowerCase())) || null
	}));
}

export interface PreviousMarketRecord {
	eventTitle: string;
	startsAt: Date;
	status: MarketVendorStatus;
	inviteBack: boolean;
	note: string | null;
}

/**
 * The newest invite-back record from an earlier market, per contact email
 * (#1505). Email is the only identity a vendor has: there is no vendor table.
 */
async function previousRecords(
	eventId: string,
	emails: (string | null)[]
): Promise<Map<string, PreviousMarketRecord>> {
	const wanted = [...new Set(emails.filter((e): e is string => !!e).map((e) => e.toLowerCase()))];
	const found = new Map<string, PreviousMarketRecord>();
	if (wanted.length === 0) return found;

	const [current] = await db
		.select({ startsAt: eventListing.startsAt })
		.from(eventListing)
		.where(eq(eventListing.id, eventId))
		.limit(1);
	if (!current) return found;

	const email = sql<string>`lower(${inboxThread.contactEmail})`;
	const rows = await db
		.select({
			email,
			eventTitle: eventListing.title,
			startsAt: eventListing.startsAt,
			status: marketVendor.status,
			inviteBack: marketVendor.inviteBack,
			note: marketVendor.inviteBackNote
		})
		.from(marketVendor)
		.innerJoin(inboxThread, eq(inboxThread.id, marketVendor.threadId))
		.innerJoin(eventListing, eq(eventListing.id, marketVendor.eventId))
		.where(
			and(
				ne(marketVendor.eventId, eventId),
				isNotNull(marketVendor.inviteBack),
				lt(eventListing.startsAt, current.startsAt),
				inArray(email, wanted)
			)
		)
		.orderBy(desc(eventListing.startsAt));
	for (const { email: key, inviteBack, ...rest } of rows) {
		if (!found.has(key)) found.set(key, { ...rest, inviteBack: inviteBack === true });
	}
	return found;
}

/**
 * The day-of list: accepted vendors and no-shows, by table then name. No
 * contact detail, so the owning committee can work the door with it.
 */
export async function listMarketDayVendors(eventId: string) {
	return db
		.select({
			id: marketVendor.id,
			businessName: marketVendor.businessName,
			offering: marketVendor.offering,
			tablesRequested: marketVendor.tablesRequested,
			needsPower: marketVendor.needsPower,
			status: marketVendor.status,
			tableLabel: marketVendor.tableLabel,
			checkedInAt: marketVendor.checkedInAt,
			inviteBack: marketVendor.inviteBack,
			inviteBackNote: marketVendor.inviteBackNote
		})
		.from(marketVendor)
		.where(
			and(eq(marketVendor.eventId, eventId), inArray(marketVendor.status, ['accepted', 'no_show']))
		)
		.orderBy(asc(marketVendor.tableLabel), asc(marketVendor.businessName));
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
	decision: 'accepted' | 'declined';
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

/**
 * Accept or decline, and tell the vendor. Returns the event id, for refreshes.
 * Accepting fixes the fee and adds the pay link to the message; declining a
 * vendor who paid refunds them first, since CMC is the one cancelling (#1502).
 */
export async function decideApplication(
	vendorId: string,
	decision: VendorDecision,
	actor: { id: string; name: string }
): Promise<{ eventId: string }> {
	const vendor = await loadVendor(vendorId);
	assertTransition(vendor.status, decision.decision);

	const accepted = decision.decision === 'accepted';
	const fee = accepted ? await feeOnAcceptance(vendor) : null;
	if (!accepted) await refundVendorFee(vendorId);

	await db
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
	if (vendor.threadId && decision.message.trim()) {
		await addOutboundMessage({
			threadId: vendor.threadId,
			body: decision.message.trim() + payLine,
			authorUserId: actor.id,
			authorName: actor.name
		});
	}
	return { eventId: vendor.eventId };
}

/** A vendor's market, read off the row: what a guard on a vendor id checks against. */
export async function getVendorEventId(vendorId: string): Promise<string> {
	return (await loadVendor(vendorId)).eventId;
}

/**
 * The committee that owns a market day: the owning group of its listing's
 * project. Null when there is no project or no owner, which leaves the
 * decision to staff alone (#1503).
 */
export async function getMarketOwnerGroupId(eventId: string): Promise<string | null> {
	const [row] = await db
		.select({ groupId: project.groupId })
		.from(eventListing)
		.innerJoin(project, eq(project.id, eventListing.projectId))
		.where(eq(eventListing.id, eventId))
		.limit(1);
	return row?.groupId ?? null;
}

/** A committee's market days, soonest first, with how many applications wait on a decision. */
export async function listCommitteeMarkets(groupId: string) {
	const rows = await db
		.select({
			eventId: marketDay.eventId,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			toReview: sql<number>`(select count(*) from ${marketVendor} where ${marketVendor.eventId} = ${marketDay.eventId} and ${marketVendor.status} = 'applied')`
		})
		.from(marketDay)
		.innerJoin(eventListing, eq(eventListing.id, marketDay.eventId))
		.innerJoin(project, eq(project.id, eventListing.projectId))
		.where(eq(project.groupId, groupId))
		.orderBy(asc(eventListing.startsAt));
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
