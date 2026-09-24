import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, getRequestEvent } from '$app/server';
import { form } from './_remote';
import { verifyTurnstile } from '$lib/server/turnstile';
import { requireCapability } from '$lib/server/authorization';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import {
	DEFAULT_TIMEZONE,
	LONG_TEXT_MAX,
	MARKET_MAX_TABLES_REQUESTED,
	SHORT_TEXT_MAX
} from '$lib/config';
import {
	decideApplication,
	getApplicationWindow,
	getMarketDay,
	getMarketEvent,
	listApplications,
	listPublicVendors,
	openMarketDay,
	setTableLabel,
	submitApplication,
	withdrawApplication
} from '$lib/server/market/market-service';

/**
 * Market vendor applications. docs/specs/shipped/market-vendors-spec.md.
 *
 * The public half takes no session: the application form is for people with
 * no account. Every staff export guards on `event.manage` (#1503).
 */

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
	const info = await getApplicationWindow(id);
	if (!info) error(404, 'Not found');
	return info;
});

/**
 * A market's section on its event page: whether it takes applications, and
 * the accepted vendors. Null for anything not a public market. Never a contact.
 */
export const getPublicMarket = query(eventId, async (id) => {
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
		notes: z.string().trim().max(LONG_TEXT_MAX).optional(),
		turnstileToken: z.string().min(1)
	}),
	async (data, issue) => {
		const ip = getRequestEvent().request.headers.get('CF-Connecting-IP');
		if (!(await verifyTurnstile(data.turnstileToken, ip))) {
			invalid(issue.turnstileToken('Verification failed. Please try again.'));
		}
		await submitApplication(data.eventId, {
			contactName: data.contactName,
			contactEmail: data.contactEmail,
			contactPhone: data.contactPhone || null,
			businessName: data.businessName,
			offering: data.offering,
			website: data.website || null,
			tablesRequested: data.tablesRequested,
			needsPower: data.needsPower ?? false,
			notes: data.notes || null
		});
		return { success: true };
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
		tableCount: z.number().int().min(1).max(500).optional()
	}),
	async (data) => {
		await requireCapability('event.manage');
		await openMarketDay(data.eventId, {
			applicationsCloseAt: parseLocalDateTime(data.applicationsCloseAt || undefined),
			tableCount: data.tableCount ?? null
		});
		void getStaffMarketVendors(data.eventId).refresh();
		return { success: true };
	}
);

export const decideVendorForm = form(
	z.object({
		vendorId: z.string().min(1),
		decision: z.enum(['accepted', 'declined']),
		tableLabel: z.string().trim().max(40).optional(),
		message: z.string().trim().min(1, 'Write the vendor a message').max(LONG_TEXT_MAX)
	}),
	async (data) => {
		const staff = await requireCapability('event.manage');
		const { eventId: id } = await decideApplication(
			data.vendorId,
			{ decision: data.decision, tableLabel: data.tableLabel, message: data.message },
			{ id: staff.id, name: staff.name }
		);
		void getStaffMarketVendors(id).refresh();
		return { success: true };
	}
);

export const setTableLabelForm = form(
	z.object({ vendorId: z.string().min(1), tableLabel: z.string().trim().max(40).optional() }),
	async (data) => {
		await requireCapability('event.manage');
		const { eventId: id } = await setTableLabel(data.vendorId, data.tableLabel || null);
		void getStaffMarketVendors(id).refresh();
		return { success: true };
	}
);

export const withdrawVendorForm = form(z.object({ vendorId: z.string().min(1) }), async (data) => {
	await requireCapability('event.manage');
	const { eventId: id } = await withdrawApplication(data.vendorId);
	void getStaffMarketVendors(id).refresh();
	return { success: true };
});
