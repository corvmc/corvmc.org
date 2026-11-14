import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, getRequestEvent } from '$app/server';
import { form } from './_remote';
import { verifyTurnstile } from '#lib/server/turnstile.js';
import { requireCapability } from '#lib/server/authorization.js';
import { requireListingVisible } from '#lib/server/event/listing-viewer.js';
import {
	requireCommitteeMember,
	requireProjectCommittee
} from '#lib/server/group/group-context.js';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import {
	DEFAULT_TIMEZONE,
	LONG_TEXT_MAX,
	MARKET_MAX_TABLES_REQUESTED,
	marketVendorDecisions,
	marketVendorStatuses,
	SHORT_TEXT_MAX
} from '#lib/config.js';
import {
	decideApplication,
	resendDecisionMessage,
	getApplicationWindow,
	getMarketDay,
	getMarketEvent,
	getMarketProjectId,
	getVendorEventId,
	checkInVendor,
	listAllApplications,
	listApplications,
	listCommitteeMarkets,
	listMarketDayVendors,
	listPublicVendors,
	markVendorNoShow,
	recordInviteBack,
	openMarketDay,
	setTableLabel,
	submitApplication,
	withdrawApplication
} from '#lib/server/market/market-service.js';
import { deliverNow } from '#lib/server/outbox/outbox-service.js';
import {
	getVendorFee,
	startVendorFeeCheckout,
	VendorFeeAmountError
} from '#lib/server/market/vendor-fee-service.js';
import { mapDomainError } from '#lib/server/errors.js';

/**
 * Market vendor applications. docs/development/business-workflows.md §19.
 *
 * The public half takes no session. Setup and the staff page, which carries
 * vendor contacts, guard on `event.manage`. Deciding, seating, withdrawals and
 * check-in also belong to the committees taking part in the market's project
 * (#1503, #2834), read off the row, never the request.
 */

/** Members of a committee on the market's project, or staff holding `event.manage`. */
async function requireMarketDecider(eventId: string) {
	return requireProjectCommittee(await getMarketProjectId(eventId), 'event.manage');
}

const eventId = z.string().min(1);
const shortText = z.string().trim().max(SHORT_TEXT_MAX);
const website = z
	.string()
	.trim()
	.url('Enter a full URL, or leave it blank')
	.max(500)
	.optional()
	.or(z.literal(''));

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** The application page's header; 404 for anything not a public market. */
export const getVendorApplyPage = query(eventId, async (id) => {
	await requireListingVisible(id);
	const info = await getApplicationWindow(id);
	if (!info) error(404, 'Not found');
	return info;
});

/**
 * A market's section on its event page: whether it takes applications, and
 * the accepted vendors. Null for anything not a public market. Never a contact.
 */
export const getPublicMarket = query(eventId, async (id) => {
	await requireListingVisible(id);
	const [info, vendors] = await Promise.all([getApplicationWindow(id), listPublicVendors(id)]);
	return info ? { info, vendors } : null;
});

export const submitVendorApplicationForm = form(
	z.object({
		eventId,
		contactName: shortText.min(1, 'Your name is required'),
		contactEmail: z.string().trim().email('Enter a valid email').max(320),
		contactPhone: z.string().trim().max(40).optional(),
		businessName: shortText.min(1, 'Your business name is required'),
		offering: z.string().trim().min(1, 'Tell us what you sell').max(LONG_TEXT_MAX),
		website,
		tablesRequested: z.number().int().min(1).max(MARKET_MAX_TABLES_REQUESTED),
		needsPower: z.boolean().optional(),
		bringsOwnTable: z.boolean().optional(),
		bringsTent: z.boolean().optional(),
		notes: z.string().trim().max(LONG_TEXT_MAX).optional(),
		turnstileToken: z.string().min(1)
	}),
	async (data, issue) => {
		const ip = getRequestEvent().request.headers.get('CF-Connecting-IP');
		if (!(await verifyTurnstile(data.turnstileToken, ip))) {
			invalid(issue.turnstileToken('Verification failed. Please try again.'));
		}
		await requireListingVisible(data.eventId);
		await submitApplication(data.eventId, {
			contactName: data.contactName,
			contactEmail: data.contactEmail,
			contactPhone: data.contactPhone || null,
			businessName: data.businessName,
			offering: data.offering,
			website: data.website || null,
			tablesRequested: data.tablesRequested,
			needsPower: data.needsPower ?? false,
			bringsOwnTable: data.bringsOwnTable ?? false,
			bringsTent: data.bringsTent ?? false,
			notes: data.notes || null
		});
		return { success: true };
	}
);

/** The table-fee page an accepted vendor is sent. The vendor id is the bearer (#1502). */
export const getVendorFeePage = query(z.string().min(1), async (vendorId) => {
	const fee = await getVendorFee(vendorId);
	if (!fee) error(404, 'Not found');
	return fee;
});

export const payVendorFeeForm = form(
	z.object({
		vendorId: z.string().min(1),
		/** Only a sliding scale asks; left out, the whole fee is charged. */
		amountCents: z.number().int().min(1, 'Enter an amount').max(1_000_000).optional()
	}),
	async (data, issue) => {
		try {
			const { checkoutUrl } = await startVendorFeeCheckout(
				data.vendorId,
				data.amountCents ?? null,
				getRequestEvent().url.origin
			);
			return { redirectUrl: checkoutUrl };
		} catch (err) {
			if (err instanceof VendorFeeAmountError) invalid(issue.amountCents(err.message));
			mapDomainError(err);
		}
	}
);

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const getStaffMarketVendors = query(eventId, async (id) => {
	await requireCapability('event.manage');
	const event = await getMarketEvent(id);
	if (!event) error(404, 'Event not found');
	const [market, applications] = await Promise.all([getMarketDay(id), listApplications(id)]);
	return { event, market, applications };
});

/** Every market's applications, for the Events list's vendor view (#2766). */
export const getStaffVendorApplications = query(
	z.object({
		status: z.enum(marketVendorStatuses).optional(),
		page: z.number().int().positive().optional()
	}),
	async ({ status, page }) => {
		await requireCapability('event.manage');
		return listAllApplications({ status }, { page: page ?? 1 });
	}
);

/** "YYYY-MM-DDTHH:mm" from a datetime-local input, read in venue time. */
function parseLocalDateTime(value: string | undefined): Date | null {
	if (!value) return null;
	const [date, time] = value.split('T');
	return buildDateInTz(date, time ?? '00:00', DEFAULT_TIMEZONE);
}

export const openMarketDayForm = form(
	z.object({
		eventId,
		applicationsCloseAt: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Pick a date and time')
			.optional()
			.or(z.literal('')),
		tableCount: z.number().int().min(1).max(500).optional(),
		/** Per table, in cents. `MoneyField` drops a cleared box, which is a free market. */
		tableFeeCents: z.number().int().min(0).max(100_000).optional(),
		slidingScale: z.boolean().optional(),
		slidingScaleFloorCents: z.number().int().min(0).max(100_000).optional()
	}),
	async (data) => {
		await requireCapability('event.manage');
		await openMarketDay(data.eventId, {
			applicationsCloseAt: parseLocalDateTime(data.applicationsCloseAt || undefined),
			tableCount: data.tableCount ?? null,
			tableFeeCents: data.tableFeeCents ?? 0,
			slidingScale: data.slidingScale ?? false,
			slidingScaleFloorCents: data.slidingScaleFloorCents ?? 0
		});
		void getStaffMarketVendors(data.eventId).refresh();
		return { success: true };
	}
);

/**
 * The owning committee's view of a market: the applications, with no contact
 * detail. Those live on the inbox thread, which is staff-only, and the decision
 * message reaches the vendor through it all the same.
 */
export const getCommitteeMarketVendors = query(eventId, async (id) => {
	await requireMarketDecider(id);
	const event = await getMarketEvent(id);
	if (!event) error(404, 'Event not found');
	const [market, applications] = await Promise.all([getMarketDay(id), listApplications(id)]);
	if (!market) error(404, 'Not a market');
	return {
		event,
		market,
		applications: applications.map(
			({ threadId: _t, contactName: _n, contactEmail: _e, contactPhone: _p, ...rest }) => rest
		)
	};
});

/** A committee's market days, for its projects tab. */
export const getCommitteeMarkets = query(z.string().min(1), async (groupId) => {
	await requireCommitteeMember(groupId, 'event.manage');
	return listCommitteeMarkets(groupId);
});

export const decideVendorForm = form(
	z.object({
		vendorId: z.string().min(1),
		decision: z.enum(marketVendorDecisions),
		tableLabel: z.string().trim().max(40).optional(),
		message: z.string().trim().min(1, 'Write the vendor a message').max(LONG_TEXT_MAX)
	}),
	async (data) => {
		const { user } = await requireMarketDecider(await getVendorEventId(data.vendorId));
		const { eventId: id, outboxId } = await decideApplication(
			data.vendorId,
			{ decision: data.decision, tableLabel: data.tableLabel, message: data.message },
			{ id: user.id, name: user.name }
		);
		void getStaffMarketVendors(id).refresh();
		void getCommitteeMarketVendors(id).refresh();
		// The decision stands either way; the page says whether the vendor was told (#2819).
		const delivery = outboxId ? await deliverNow(outboxId) : null;
		return { success: true, messageSent: delivery?.status === 'sent' };
	}
);

/** Send a decision message that did not reach the vendor (#2819). */
export const resendVendorDecisionForm = form(
	z.object({ vendorId: z.string().min(1) }),
	async (data) => {
		await requireVendorMarketDecider(data.vendorId);
		const delivery = await resendDecisionMessage(data.vendorId);
		refreshMarket(await getVendorEventId(data.vendorId));
		return { success: true, messageSent: delivery?.status === 'sent' };
	}
);

export const setTableLabelForm = form(
	z.object({ vendorId: z.string().min(1), tableLabel: z.string().trim().max(40).optional() }),
	async (data) => {
		await requireVendorMarketDecider(data.vendorId);
		const { eventId: id } = await setTableLabel(data.vendorId, data.tableLabel || null);
		refreshMarket(id);
		return { success: true };
	}
);

export const withdrawVendorForm = form(z.object({ vendorId: z.string().min(1) }), async (data) => {
	await requireVendorMarketDecider(data.vendorId);
	const { eventId: id } = await withdrawApplication(data.vendorId);
	refreshMarket(id);
	return { success: true };
});

// ---------------------------------------------------------------------------
// Market day (#1505): the owning committee, or staff, work the door
// ---------------------------------------------------------------------------

/** The check-in page: accepted vendors and no-shows, with no contact detail. */
export const getMarketDayCheckIn = query(eventId, async (id) => {
	await requireMarketDecider(id);
	const event = await getMarketEvent(id);
	if (!event) error(404, 'Event not found');
	const [market, vendors] = await Promise.all([getMarketDay(id), listMarketDayVendors(id)]);
	if (!market) error(404, 'Not a market');
	return { event, vendors };
});

const yesNo = z.enum(['yes', 'no']);

async function requireVendorMarketDecider(vendorId: string) {
	return requireMarketDecider(await getVendorEventId(vendorId));
}

function refreshMarket(id: string) {
	void getMarketDayCheckIn(id).refresh();
	void getStaffMarketVendors(id).refresh();
	void getCommitteeMarketVendors(id).refresh();
}

export const checkInVendorForm = form(
	z.object({ vendorId: z.string().min(1), arrived: yesNo }),
	async (data) => {
		await requireVendorMarketDecider(data.vendorId);
		const { eventId: id } = await checkInVendor(data.vendorId, data.arrived === 'yes');
		refreshMarket(id);
		return { success: true };
	}
);

export const markNoShowForm = form(
	z.object({ vendorId: z.string().min(1), noShow: yesNo }),
	async (data) => {
		await requireVendorMarketDecider(data.vendorId);
		const { eventId: id } = await markVendorNoShow(data.vendorId, data.noShow === 'yes');
		refreshMarket(id);
		return { success: true };
	}
);

export const inviteBackForm = form(
	z.object({
		vendorId: z.string().min(1),
		inviteBack: yesNo,
		note: z.string().trim().max(LONG_TEXT_MAX).optional()
	}),
	async (data) => {
		await requireVendorMarketDecider(data.vendorId);
		const { eventId: id } = await recordInviteBack(data.vendorId, {
			inviteBack: data.inviteBack === 'yes',
			note: data.note ?? ''
		});
		refreshMarket(id);
		return { success: true };
	}
);
