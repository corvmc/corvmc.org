import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeNotificationModel } from './email/normalize-model';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn().mockResolvedValue(undefined);
const mockDispatchEmailOnly = vi.fn().mockResolvedValue(undefined);

vi.mock('./dispatcher', () => ({
	dispatch: (...args: unknown[]) => mockDispatch(...args),
	dispatchEmailOnly: (...args: unknown[]) => mockDispatchEmailOnly(...args)
}));

vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const mockStaffUsers = vi.fn(async () => [
	{ id: 'staff-1', name: 'Ada', email: 'ada@test.com' },
	{ id: 'staff-2', name: 'Bo', email: 'bo@test.com' }
]);
vi.mock('$lib/server/authorization', () => ({
	listStaffUsers: () => mockStaffUsers()
}));

// Returns null when INBOX_REPLY_ADDRESS is unconfigured, which is a supported
// production state — both branches are exercised below.
const mockBuildReplyToAddress = vi.fn((threadId: string) => `reply+${threadId}.sig@replies.test`);
vi.mock('$lib/server/inbox/reply-address', () => ({
	buildReplyToAddress: (threadId: string) => mockBuildReplyToAddress(threadId)
}));

vi.mock('$env/dynamic/private', () => ({
	env: { PUBLIC_SITE_URL: 'https://test.corvmc.com', STAFF_CONTACT_EMAIL: 'staff@test.com' }
}));

// Capture event handlers
const handlers: Record<string, (...args: any[]) => any> = {};
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: {
		on: (event: string, handler: (...args: any[]) => any) => {
			handlers[event] = handler;
		},
		emit: vi.fn()
	}
}));

const { registerAllNotificationListeners } = await import('./notification-listeners');

// Emittery wraps emitted payloads as `{ name, data }` before invoking
// listeners. Calling handlers directly in tests must mirror that envelope.
function emit(event: string, payload: unknown): Promise<unknown> {
	return handlers[event]({ data: payload });
}

function paragraphText(model: { paragraphs?: { text: string }[] }): string {
	return (model.paragraphs ?? []).map((p) => p.text).join('\n');
}

interface Detail {
	label: string;
	value: string;
}

/** The details-card rows as "Label: value" lines, for substring assertions. */
function detailText(model: { details?: Detail[] }): string {
	return (model.details ?? []).map((d) => `${d.label}: ${d.value}`).join('\n');
}

function detailLabels(model: { details?: Detail[] }): string[] {
	return (model.details ?? []).map((d) => d.label);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
});

// All transactional emails (except ticket-confirmation + inbox-reply) render
// through the single generic `notification` template.
const GENERIC = 'notification';

const volunteerPayload = {
	logId: 'log-1',
	userId: 'user-1',
	userName: 'Bob',
	userEmail: 'u@test.com',
	roleName: 'Front Desk',
	hours: 2,
	workedOn: '2026-05-21T19:00:00.000Z',
	reviewNotes: null as string | null,
	reviewedByName: 'Ada'
};

describe('registerAllNotificationListeners', () => {
	it('registers handlers for all expected events', () => {
		registerAllNotificationListeners();

		for (const event of [
			'ticket.purchased',
			'event.cancelled',
			'reservation.reminder_due',
			'reservation.confirmation_reminder_due',
			'reservation.cancelled',
			'band.invitation_sent',
			'band.invitation_accepted',
			'platform_invite.created',
			'reservation.recurring_skipped',
			'reservation.recurring_waitlisted',
			'reservation.waitlist_slot_available',
			'reservation.waitlist_expired',
			'equipment.loan_scheduled',
			'equipment.loan_requested',
			'equipment.checked_out',
			'equipment.returned',
			'contact.form_submitted',
			'volunteer.hours_submitted',
			'volunteer.hours_approved',
			'volunteer.hours_rejected'
		]) {
			expect(handlers[event], event).toBeDefined();
		}
	});
});

describe('ticket.purchased handler (dedicated template)', () => {
	beforeEach(() => registerAllNotificationListeners());

	/** A paid two-ticket purchase with the buyer covering fees. */
	const purchase = {
		purchaseId: 'a1b2c3d4-5678-90ab-cdef-000000000000',
		eventId: 'event-1',
		attendeeName: 'Alice',
		attendeeEmail: 'alice@test.com',
		eventTitle: 'Jazz Night',
		eventDate: 'May 20',
		eventTime: '8:00 PM',
		ticketCodes: ['ABC123', 'DEF456'],
		quantity: 2,
		unitPriceCents: 2000,
		subtotalCents: 4000,
		feesCents: 120,
		totalCents: 4120
	};

	/** The model handed to the ticket-confirmation template. */
	function ticketModel(): Record<string, unknown> {
		return mockDispatchEmailOnly.mock.calls[0][0].model;
	}

	it('sends email-only notification with the ticket-confirmation template', async () => {
		await emit('ticket.purchased', purchase);

		expect(mockDispatchEmailOnly).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'ticket_confirmation',
				toEmail: 'alice@test.com',
				templateAlias: 'ticket-confirmation',
				model: expect.objectContaining({
					multiple: true,
					ticketCodes: [{ code: 'ABC123' }, { code: 'DEF456' }]
				})
			})
		);
	});

	it('includes the receipt amounts, order id, and a link back to the tickets', async () => {
		await emit('ticket.purchased', purchase);

		expect(ticketModel()).toMatchObject({
			unitPrice: '$20.00',
			subtotal: '$40.00',
			feesCovered: true,
			fees: '$1.20',
			total: '$41.20',
			orderId: 'A1B2C3D4',
			ticketsUrl:
				'https://test.corvmc.com/events/event-1/tickets/success?purchase_id=a1b2c3d4-5678-90ab-cdef-000000000000'
		});
	});

	it('flags fees as not covered when none were charged', async () => {
		await emit('ticket.purchased', { ...purchase, feesCents: 0, totalCents: 4000 });

		expect(ticketModel()).toMatchObject({ feesCovered: false, total: '$40.00' });
	});
});

describe('collapsed listeners use the generic template', () => {
	beforeEach(() => registerAllNotificationListeners());

	it('reservation.reminder_due → notification alias with subject/heading/cta', async () => {
		await emit('reservation.reminder_due', {
			userId: 'user-1',
			userEmail: 'user@test.com',
			userName: 'Bob',
			date: 'May 21',
			startTime: '10:00 AM',
			endTime: '11:00 AM'
		});

		const params = mockDispatch.mock.calls[0][0];
		expect(params.type).toBe('reservation_reminder');
		expect(params.emailTemplate.alias).toBe(GENERIC);
		expect(params.emailTemplate.model.subject).toBe('Reservation reminder: May 21');
		expect(params.emailTemplate.model.heading).toBe('Upcoming Reservation');
		expect(params.emailTemplate.model.details).toEqual([
			{ label: 'Date', value: 'May 21' },
			{ label: 'Time', value: '10:00 AM – 11:00 AM' }
		]);
		expect(params.emailTemplate.model.cta).toEqual({
			url: 'https://test.corvmc.com/member/reservations',
			label: 'View My Reservations'
		});
	});

	it('confirmation_reminder → notification alias', async () => {
		await emit('reservation.confirmation_reminder_due', {
			userId: 'user-1',
			userEmail: 'user@test.com',
			userName: 'Bob',
			date: 'May 22',
			startTime: '2:00 PM',
			endTime: '3:00 PM'
		});

		const params = mockDispatch.mock.calls[0][0];
		expect(params.type).toBe('confirmation_reminder');
		expect(params.emailTemplate.alias).toBe(GENERIC);
		expect(params.emailTemplate.model.subject).toBe('Please confirm your reservation: May 22');
	});

	it('band.invitation_sent → notification alias', async () => {
		await emit('band.invitation_sent', {
			invitedUserId: 'user-2',
			invitedUserEmail: 'invited@test.com',
			invitedUserName: 'Bob',
			bandName: 'The Strokes',
			invitedByName: 'Alice'
		});

		const params = mockDispatch.mock.calls[0][0];
		expect(params.type).toBe('band_invitation');
		expect(params.emailTemplate.alias).toBe(GENERIC);
		expect(params.emailTemplate.model.subject).toBe('Alice invited you to The Strokes');
	});

	it('platform_invite.created → email-only notification alias with signup link', async () => {
		await emit('platform_invite.created', {
			email: 'new@test.com',
			token: 'tok-xyz',
			bandId: 'band-1',
			bandName: 'The Strokes',
			role: 'member',
			invitedByName: 'Alice'
		});

		const params = mockDispatchEmailOnly.mock.calls[0][0];
		expect(params.type).toBe('platform_invitation');
		expect(params.templateAlias).toBe(GENERIC);
		expect(params.model.cta.url).toBe('https://test.corvmc.com/login?invite=tok-xyz');
		expect(params.model.footnote).toBe('This invitation expires in 7 days.');
	});

	const contactFormEvent = {
		threadId: 'thread-9',
		name: 'Charlie',
		email: 'charlie@test.com',
		subject: 'General Inquiry',
		message: 'Hello, I have a question'
	};

	it('contact.form_submitted → plaintext contact-alert template to staff', async () => {
		await emit('contact.form_submitted', contactFormEvent);

		const params = mockDispatchEmailOnly.mock.calls[0][0];
		expect(params.type).toBe('contact_form');
		expect(params.toEmail).toBe('staff@test.com');
		// Not the generic template: staff can reply to this one, so it is
		// plaintext with no layout.
		expect(params.templateAlias).toBe('contact-alert');
		expect(params.model.subject).toBe('Contact form: General Inquiry');
		expect(params.model.contactName).toBe('Charlie');
		expect(params.model.contactEmail).toBe('charlie@test.com');
		expect(params.model.formSubject).toBe('General Inquiry');
		expect(params.model.message).toBe('Hello, I have a question');
		expect(params.model.threadUrl).toBe('https://test.corvmc.com/staff/inbox/thread-9');
	});

	it('contact.form_submitted → replies route back through the thread address', async () => {
		await emit('contact.form_submitted', contactFormEvent);

		const params = mockDispatchEmailOnly.mock.calls[0][0];
		expect(params.replyTo).toBe('reply+thread-9.sig@replies.test');
		expect(params.model.replyNote).toContain('saved on the conversation in the staff inbox');
	});

	it('contact.form_submitted → falls back to the sender when no reply address is configured', async () => {
		mockBuildReplyToAddress.mockReturnValueOnce(null as unknown as string);

		await emit('contact.form_submitted', contactFormEvent);

		// An unlogged reply that arrives beats a logged one that never sends —
		// and the copy has to say which mode staff are in.
		const params = mockDispatchEmailOnly.mock.calls[0][0];
		expect(params.replyTo).toBe('charlie@test.com');
		expect(params.model.replyNote).toContain('NOT saved to the staff inbox');
	});

	it('loan_requested → notification alias, omits notes line when none', async () => {
		await emit('equipment.loan_requested', {
			userName: 'Bob',
			equipmentName: 'SM58',
			memberNotes: null,
			requestedPickupDate: '2026-06-01',
			loanId: 'loan-1'
		});

		const params = mockDispatchEmailOnly.mock.calls[0][0];
		expect(params.templateAlias).toBe(GENERIC);
		expect(detailLabels(params.model)).not.toContain('Notes');
		expect(params.model.cta.url).toBe('https://test.corvmc.com/staff/equipment/loans/loan-1');
	});
});

describe('event.cancelled handler', () => {
	beforeEach(() => registerAllNotificationListeners());

	it('uses dispatch (generic alias) for holders with a userId', async () => {
		await emit('event.cancelled', {
			eventTitle: 'Jazz Night',
			eventDate: 'May 20',
			refundNote: 'Full refund within 5 days',
			ticketHolders: [{ attendeeName: 'Alice', attendeeEmail: 'alice@test.com', userId: 'user-1' }]
		});

		const params = mockDispatch.mock.calls[0][0];
		expect(params.type).toBe('event_cancellation');
		expect(params.emailTemplate.alias).toBe(GENERIC);
		expect(params.emailTemplate.model.subject).toBe('Jazz Night has been cancelled');
	});

	it('uses dispatchEmailOnly (generic alias) for holders without a userId', async () => {
		await emit('event.cancelled', {
			eventTitle: 'Jazz Night',
			eventDate: 'May 20',
			refundNote: 'Full refund within 5 days',
			ticketHolders: [{ attendeeName: 'Bob', attendeeEmail: 'bob@test.com', userId: null }]
		});

		expect(mockDispatchEmailOnly).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'event_cancellation', templateAlias: GENERIC })
		);
	});

	it('continues notifying remaining holders if one fails', async () => {
		mockDispatch.mockRejectedValueOnce(new Error('fail'));

		await emit('event.cancelled', {
			eventTitle: 'Jazz Night',
			eventDate: 'May 20',
			refundNote: 'Refund pending',
			ticketHolders: [
				{ attendeeName: 'Alice', attendeeEmail: 'alice@test.com', userId: 'user-1' },
				{ attendeeName: 'Bob', attendeeEmail: 'bob@test.com', userId: 'user-2' }
			]
		});

		expect(mockDispatch).toHaveBeenCalledTimes(2);
	});
});

describe('band.invitation_accepted handler', () => {
	beforeEach(() => registerAllNotificationListeners());

	it('notifies each band admin via the generic alias', async () => {
		await emit('band.invitation_accepted', {
			acceptedByName: 'Charlie',
			bandName: 'The Strokes',
			bandId: 'band-1',
			bandAdmins: [
				{ userId: 'admin-1', userEmail: 'admin1@test.com', userName: 'Alice' },
				{ userId: 'admin-2', userEmail: 'admin2@test.com', userName: 'Dave' }
			]
		});

		expect(mockDispatch).toHaveBeenCalledTimes(2);
		const first = mockDispatch.mock.calls[0][0];
		expect(first.type).toBe('band_invitation_accepted');
		expect(first.emailTemplate.alias).toBe(GENERIC);
		expect(first.emailTemplate.model.subject).toBe('Charlie joined The Strokes');
	});

	it('continues notifying remaining admins if one fails', async () => {
		mockDispatch.mockRejectedValueOnce(new Error('fail'));

		await emit('band.invitation_accepted', {
			acceptedByName: 'Charlie',
			bandName: 'The Strokes',
			bandId: 'band-1',
			bandAdmins: [
				{ userId: 'admin-1', userEmail: 'admin1@test.com', userName: 'Alice' },
				{ userId: 'admin-2', userEmail: 'admin2@test.com', userName: 'Dave' }
			]
		});

		expect(mockDispatch).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// Gap listeners (new)
// ---------------------------------------------------------------------------

describe('equipment.checked_out handler', () => {
	beforeEach(() => registerAllNotificationListeners());

	it('emails the member a checkout confirmation', async () => {
		await emit('equipment.checked_out', {
			loanId: 'l1',
			userId: 'user-1',
			userName: 'Bob',
			userEmail: 'user@test.com',
			equipmentName: 'SM58'
		});

		expect(mockDispatch).toHaveBeenCalledTimes(1);
		const params = mockDispatch.mock.calls[0][0];
		expect(params.type).toBe('equipment_checked_out');
		expect(params.userEmail).toBe('user@test.com');
		expect(params.emailTemplate.alias).toBe(GENERIC);
		expect(params.emailTemplate.model.subject).toBe('Equipment checked out: SM58');
	});
});

describe('equipment.returned handler', () => {
	beforeEach(() => registerAllNotificationListeners());

	it('emails a return summary with charge breakdown when charged', async () => {
		await emit('equipment.returned', {
			loanId: 'l1',
			userId: 'user-1',
			userName: 'Bob',
			userEmail: 'user@test.com',
			equipmentName: 'SM58',
			totalChargeCents: 1500,
			creditsCents: 500,
			cashCents: 1000,
			daysBorrowed: 3
		});

		const params = mockDispatch.mock.calls[0][0];
		expect(params.type).toBe('equipment_returned');
		expect(params.emailTemplate.alias).toBe(GENERIC);
		const text = detailText(params.emailTemplate.model);
		expect(text).toContain('3 days');
		expect(text).toContain('$15.00');
		expect(text).toContain('credits $5.00, cash $10.00');
	});

	it('omits the charge line when there is no charge', async () => {
		await emit('equipment.returned', {
			loanId: 'l1',
			userId: 'user-1',
			userName: 'Bob',
			userEmail: 'user@test.com',
			equipmentName: 'SM58',
			totalChargeCents: 0,
			creditsCents: 0,
			cashCents: 0,
			daysBorrowed: 1
		});

		const model = mockDispatch.mock.calls[0][0].emailTemplate.model;
		expect(detailLabels(model)).not.toContain('Total charge');
		expect(detailText(model)).toContain('1 day');
	});
});

describe('reservation.cancelled handler', () => {
	beforeEach(() => registerAllNotificationListeners());

	const base = {
		reservationId: 'r1',
		userId: 'user-1',
		userName: 'Bob',
		userEmail: 'user@test.com',
		date: 'May 21',
		startTime: '10:00 AM',
		endTime: '11:00 AM'
	};

	it('emails the member when cancelled by staff', async () => {
		await emit('reservation.cancelled', { ...base, cancelledBy: 'staff' });

		expect(mockDispatch).toHaveBeenCalledTimes(1);
		const params = mockDispatch.mock.calls[0][0];
		expect(params.type).toBe('reservation_cancelled');
		expect(params.emailTemplate.alias).toBe(GENERIC);
		expect(params.emailTemplate.model.subject).toBe('Reservation cancelled: May 21');
	});

	it('does NOT email when the member cancelled their own reservation', async () => {
		await emit('reservation.cancelled', { ...base, cancelledBy: 'member' });

		expect(mockDispatch).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Blanket guards across every generic-alias email
// ---------------------------------------------------------------------------
// These two defects each shipped in ~19 emails at once because nothing checked
// the whole set. Assert over every model any listener produces, so a new
// listener can't reintroduce them.

describe('volunteer hour-log handlers', () => {
	beforeEach(() => registerAllNotificationListeners());

	// Fans out per-staffer rather than to one STAFF_CONTACT_EMAIL, so the queue
	// gets an in-app badge and each staffer's own preference is honored.
	it('dispatches a submission to every staff member in-app', async () => {
		await emit('volunteer.hours_submitted', {
			logId: 'log-1',
			userId: 'user-1',
			userName: 'Bob',
			userEmail: 'u@test.com',
			roleName: 'Front Desk',
			hours: 2,
			workedOn: '2026-05-21T19:00:00.000Z',
			description: 'Covered the door'
		});

		expect(mockDispatch).toHaveBeenCalledTimes(2);
		expect(mockDispatchEmailOnly).not.toHaveBeenCalled();
		expect(mockDispatch.mock.calls.map((c) => c[0].userId)).toEqual(['staff-1', 'staff-2']);
	});

	it('carries no email template on the staff submission notice', async () => {
		await emit('volunteer.hours_submitted', {
			logId: 'log-1',
			userId: 'user-1',
			userName: 'Bob',
			userEmail: 'u@test.com',
			roleName: 'Front Desk',
			hours: 2,
			workedOn: '2026-05-21T19:00:00.000Z',
			description: 'Covered the door'
		});

		expect(mockDispatch.mock.calls[0][0].emailTemplate).toBeUndefined();
		expect(mockDispatch.mock.calls[0][0].href).toBe('/staff/volunteer');
	});

	// One staffer with a bad address must not swallow the rest of the fan-out.
	it('keeps notifying staff after one dispatch throws', async () => {
		mockDispatch.mockRejectedValueOnce(new Error('bad address'));

		await emit('volunteer.hours_submitted', {
			logId: 'log-1',
			userId: 'user-1',
			userName: 'Bob',
			userEmail: 'u@test.com',
			roleName: 'Front Desk',
			hours: 2,
			workedOn: '2026-05-21T19:00:00.000Z',
			description: 'Covered the door'
		});

		expect(mockDispatch).toHaveBeenCalledTimes(2);
	});

	it('emails the member on approval with date, role, and hours', async () => {
		await emit('volunteer.hours_approved', { ...volunteerPayload });

		const call = mockDispatch.mock.calls[0][0];
		expect(call.userId).toBe('user-1');
		expect(call.emailTemplate.alias).toBe(GENERIC);
		expect(detailLabels(call.emailTemplate.model)).toEqual(['Date', 'Role', 'Hours']);
		expect(detailText(call.emailTemplate.model)).toContain('Front Desk');
	});

	// The reason is the point of the rejection email — without it the member
	// can't correct and resubmit, which is why the service demands one.
	it('carries the reason on a rejection', async () => {
		await emit('volunteer.hours_rejected', {
			...volunteerPayload,
			reviewNotes: 'Looks like a duplicate'
		});

		const call = mockDispatch.mock.calls[0][0];
		expect(call.body).toBe('Looks like a duplicate');
		expect(detailLabels(call.emailTemplate.model)).toContain('Reason');
		expect(paragraphText(call.emailTemplate.model)).toContain('Looks like a duplicate');
	});

	it('pluralizes hours correctly', async () => {
		await emit('volunteer.hours_approved', { ...volunteerPayload, hours: 1 });
		expect(mockDispatch.mock.calls[0][0].title).toContain('1 hour of');

		mockDispatch.mockClear();
		await emit('volunteer.hours_approved', { ...volunteerPayload, hours: 1.5 });
		expect(mockDispatch.mock.calls[0][0].title).toContain('1.5 hours');
	});
});

describe('every notification-alias model', () => {
	beforeEach(() => registerAllNotificationListeners());

	/** Fire one representative event per listener and collect the email models. */
	async function collectModels(): Promise<Record<string, unknown>[]> {
		const when = { date: 'May 21', startTime: '10:00 AM', endTime: '11:00 AM' };
		const member = { userId: 'user-1', userEmail: 'u@test.com', userName: 'Bob' };

		await emit('reservation.reminder_due', { ...member, ...when });
		await emit('reservation.confirmation_reminder_due', { ...member, ...when });
		await emit('reservation.cancelled', { ...member, ...when, cancelledBy: 'staff' });
		await emit('reservation.recurring_waitlisted', { ...member, ...when });
		await emit('reservation.waitlist_expired', { ...member, ...when });
		await emit('reservation.waitlist_slot_available', {
			...member,
			...when,
			reservationId: 'r1',
			confirmUrl: 'https://test.corvmc.com/confirm'
		});
		await emit('reservation.recurring_skipped', {
			...member,
			skippedDate: 'May 21',
			startTime: when.startTime,
			endTime: when.endTime,
			reason: 'Space closed'
		});
		await emit('event.recurring_reservation_skipped', {
			...member,
			...when,
			eventId: 'e1',
			eventTitle: 'Open Jam',
			reason: 'Conflict'
		});
		await emit('event.cancelled', {
			eventTitle: 'Jazz Night',
			eventDate: 'May 20',
			refundNote: 'Full refund',
			ticketHolders: [{ userId: 'user-1', attendeeName: 'Ada', attendeeEmail: 'a@test.com' }]
		});
		await emit('band.invitation_sent', {
			invitedUserId: 'user-2',
			invitedUserEmail: 'i@test.com',
			invitedUserName: 'Ada',
			invitedByName: 'Bob',
			bandName: 'Indigo Kiss'
		});
		await emit('band.invitation_accepted', {
			bandId: 'b1',
			bandName: 'Indigo Kiss',
			acceptedByName: 'Ada',
			bandAdmins: [{ userId: 'user-1', userEmail: 'u@test.com', userName: 'Bob' }]
		});
		await emit('platform_invite.created', {
			email: 'new@test.com',
			token: 'tok',
			role: 'member',
			bandName: 'Indigo Kiss',
			invitedByName: 'Bob'
		});
		await emit('equipment.loan_scheduled', {
			...member,
			equipmentName: 'SM58',
			scheduledPickupDate: '2026-06-01'
		});
		await emit('equipment.loan_requested', {
			userName: 'Bob',
			equipmentName: 'SM58',
			memberNotes: 'Ships Friday',
			requestedPickupDate: '2026-06-01',
			loanId: 'loan-1'
		});
		await emit('equipment.checked_out', { ...member, equipmentName: 'SM58' });
		await emit('equipment.returned', {
			...member,
			loanId: 'l1',
			equipmentName: 'SM58',
			totalChargeCents: 1500,
			creditsCents: 500,
			cashCents: 1000,
			daysBorrowed: 3
		});
		await emit('contact.form_submitted', {
			threadId: 't9',
			name: 'Charlie',
			email: 'c@test.com',
			subject: 'Hi',
			message: 'Hello'
		});
		await emit('event.unpublished_by_staff', {
			bandId: 'b1',
			bandName: 'Indigo Kiss',
			eventTitle: 'Show',
			notes: 'Reported',
			bandAdmins: [{ userId: 'user-1', userEmail: 'u@test.com', userName: 'Bob' }]
		});
		await emit('volunteer.hours_approved', { ...volunteerPayload });
		await emit('volunteer.hours_rejected', {
			...volunteerPayload,
			reviewNotes: 'Looks like a duplicate'
		});

		return [
			...mockDispatch.mock.calls
				.filter((c) => c[0].emailTemplate?.alias === GENERIC)
				.map((c) => c[0].emailTemplate.model),
			...mockDispatchEmailOnly.mock.calls
				.filter((c) => c[0].templateAlias === GENERIC)
				.map((c) => c[0].model)
		];
	}

	it('never smuggles HTML into paragraphs or details', async () => {
		const models = await collectModels();
		expect(models.length).toBeGreaterThan(15);

		for (const model of models) {
			// The template escapes these fields, so any markup here would render
			// literally as "<strong>Date:</strong>" in the member's inbox.
			for (const p of (model.paragraphs ?? []) as { text: string }[]) {
				expect(p.text).not.toMatch(/<[a-z/]/i);
			}
			for (const d of (model.details ?? []) as Detail[]) {
				expect(`${d.label}${d.value}`).not.toMatch(/<[a-z/]/i);
			}
		}
	});

	it('produces a non-empty preheader for every email', async () => {
		const models = await collectModels();

		for (const model of models) {
			// Either written deliberately, or derived by the dispatcher's normalizer.
			const preview =
				(model.preview_text as string | undefined) ??
				(normalizeNotificationModel(model as never).preview_text as string);
			expect(preview?.trim()).toBeTruthy();
		}
	});
});
