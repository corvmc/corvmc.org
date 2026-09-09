import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNotificationType } from '$lib/server/db/schema/notification';
import { NOTIFICATION_CATEGORIES } from '$lib/email/notification-category';

vi.mock('./email/postmark-client', () => ({ sendEmailWithTemplate: vi.fn() }));
vi.mock('./in-app-service', () => ({ createNotification: vi.fn() }));
vi.mock('./preference-service', () => ({ getPreference: vi.fn() }));
vi.mock('./sse', () => ({ pushToUser: vi.fn() }));
vi.mock('./recipient', () => ({ isDeliverable: vi.fn() }));

const EMAIL_CONTENT = {
	recipientName: 'Ada',
	subject: 'Your reservation is confirmed',
	heading: 'Reservation confirmed',
	paragraphs: [{ text: 'Your reservation has been confirmed.' }],
	cta: { label: 'View my reservations' }
};

/** What the email layer makes of `EMAIL_CONTENT` on the way out. */
const SENT_MODEL = {
	subject: EMAIL_CONTENT.subject,
	heading: EMAIL_CONTENT.heading,
	greeting: 'Hi Ada,',
	paragraphs: EMAIL_CONTENT.paragraphs,
	cta: { url: 'https://corvmc.org/reservations/1', label: 'View my reservations' },
	preview_text: 'Your reservation has been confirmed.',
	has_details: false
};

const BASE_PARAMS = {
	type: 'reservation.confirmed',
	userId: 'user-1',
	userEmail: 'user@example.com',
	title: 'Reservation Confirmed',
	body: 'Your reservation has been confirmed.',
	href: '/reservations/1',
	email: EMAIL_CONTENT
};

const FAKE_ROW = {
	id: 'notif-1',
	type: BASE_PARAMS.type,
	title: BASE_PARAMS.title,
	body: BASE_PARAMS.body,
	href: BASE_PARAMS.href,
	createdAt: new Date('2026-01-01T00:00:00Z')
};

// Module scope, not per-`beforeEach`: on a cold Vite cache the first import pays
// the transform of this module graph inside the hook timeout and reports as a
// timeout rather than a slow build. Same reason as commit 75fd70a. These are the
// mocked modules, so the bindings are stable — `vi.resetAllMocks()` clears their
// recorded calls without replacing the function objects.
const { sendEmailWithTemplate } = (await import('./email/postmark-client')) as any;
const { createNotification } = (await import('./in-app-service')) as any;
const { getPreference } = (await import('./preference-service')) as any;
const { pushToUser } = (await import('./sse')) as any;
const { isDeliverable } = (await import('./recipient')) as any;
const { dispatch, dispatchEmailOnly } = (await import('./dispatcher')) as any;

describe('dispatch', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		isDeliverable.mockResolvedValue(true);
		createNotification.mockResolvedValue(FAKE_ROW);
	});

	it('sends in-app notification and SSE push when pref.inApp is true', async () => {
		getPreference.mockResolvedValue({ email: false, inApp: true });

		await dispatch({ ...BASE_PARAMS, email: undefined });

		expect(createNotification).toHaveBeenCalledWith({
			userId: BASE_PARAMS.userId,
			type: BASE_PARAMS.type,
			title: BASE_PARAMS.title,
			body: BASE_PARAMS.body,
			href: BASE_PARAMS.href,
			data: undefined
		});
		expect(pushToUser).toHaveBeenCalledWith(BASE_PARAMS.userId, {
			id: FAKE_ROW.id,
			type: FAKE_ROW.type,
			title: FAKE_ROW.title,
			body: FAKE_ROW.body,
			href: FAKE_ROW.href,
			createdAt: FAKE_ROW.createdAt.toISOString()
		});
	});

	it('builds the generic-template model from declared content', async () => {
		getPreference.mockResolvedValue({ email: true, inApp: false });

		await dispatch(BASE_PARAMS);

		expect(sendEmailWithTemplate).toHaveBeenCalledWith({
			to: BASE_PARAMS.userEmail,
			templateAlias: 'notification',
			model: SENT_MODEL,
			tag: BASE_PARAMS.type
		});
	});

	it('skips email when no content was declared', async () => {
		getPreference.mockResolvedValue({ email: true, inApp: false });

		await dispatch({ ...BASE_PARAMS, email: undefined });

		expect(sendEmailWithTemplate).not.toHaveBeenCalled();
	});

	// Nothing in the notification path knew about `user.deletedAt`, and one of
	// the lists it fans out to is a band roster — so a member removed by staff
	// kept getting mail from the organisation that removed them. Guarded once
	// here rather than in each fan-out. #813.
	it('delivers nothing to a removed account, on any channel', async () => {
		getPreference.mockResolvedValue({ email: true, inApp: true });
		isDeliverable.mockResolvedValue(false);

		await dispatch(BASE_PARAMS);

		expect(createNotification).not.toHaveBeenCalled();
		expect(pushToUser).not.toHaveBeenCalled();
		expect(sendEmailWithTemplate).not.toHaveBeenCalled();
		expect(getPreference).not.toHaveBeenCalled();
	});

	// The removal confirmation a closing account is owed still has to reach it,
	// and a ticket buyer has no account to check at all.
	it('still sends a forceEmail with no userId to check', async () => {
		getPreference.mockResolvedValue({ email: false, inApp: false });

		await dispatch({ ...BASE_PARAMS, userId: '', forceEmail: true });

		expect(isDeliverable).not.toHaveBeenCalled();
		expect(sendEmailWithTemplate).toHaveBeenCalled();
	});

	it('sends email via forceEmail even when pref.email is false', async () => {
		getPreference.mockResolvedValue({ email: false, inApp: false });

		await dispatch({ ...BASE_PARAMS, forceEmail: true });

		expect(sendEmailWithTemplate).toHaveBeenCalledWith({
			to: BASE_PARAMS.userEmail,
			templateAlias: 'notification',
			model: SENT_MODEL,
			tag: BASE_PARAMS.type
		});
	});

	it('skips in-app notification and SSE when pref.inApp is false', async () => {
		getPreference.mockResolvedValue({ email: false, inApp: false });

		await dispatch(BASE_PARAMS);

		expect(createNotification).not.toHaveBeenCalled();
		expect(pushToUser).not.toHaveBeenCalled();
	});

	it('logs error but does not throw if createNotification fails', async () => {
		getPreference.mockResolvedValue({ email: false, inApp: true });
		createNotification.mockRejectedValue(new Error('DB error'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(dispatch({ ...BASE_PARAMS, email: undefined })).resolves.toBeUndefined();

		expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
		consoleSpy.mockRestore();
	});

	it('logs error but does not throw if sendEmailWithTemplate fails', async () => {
		getPreference.mockResolvedValue({ email: true, inApp: false });
		sendEmailWithTemplate.mockRejectedValue(new Error('Postmark error'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(dispatch(BASE_PARAMS)).resolves.toBeUndefined();

		expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
		consoleSpy.mockRestore();
	});
});

describe('dispatchEmailOnly', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		isDeliverable.mockResolvedValue(true);
	});

	it('sends a templated email with the provided params', async () => {
		sendEmailWithTemplate.mockResolvedValue(undefined);

		await dispatchEmailOnly({
			type: 'ticket.purchased',
			toEmail: 'buyer@example.com',
			templateAlias: 'ticket-confirmation',
			model: { attendeeName: 'Ada' }
		});

		expect(sendEmailWithTemplate).toHaveBeenCalledWith({
			to: 'buyer@example.com',
			templateAlias: 'ticket-confirmation',
			model: { attendeeName: 'Ada' },
			tag: 'ticket.purchased'
		});
	});

	it('forwards replyTo so the recipient can answer a two-way email', async () => {
		sendEmailWithTemplate.mockResolvedValue(undefined);

		await dispatchEmailOnly({
			type: 'contact_form',
			toEmail: 'staff@example.com',
			templateAlias: 'contact-alert',
			model: {},
			replyTo: 'reply+thread-1.sig@replies.example.com'
		});

		expect(sendEmailWithTemplate.mock.calls[0][0].replyTo).toBe(
			'reply+thread-1.sig@replies.example.com'
		);
	});

	it('logs error but does not throw on send failure', async () => {
		sendEmailWithTemplate.mockRejectedValue(new Error('Network error'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(
			dispatchEmailOnly({
				type: 'ticket.purchased',
				toEmail: 'buyer@example.com',
				templateAlias: 'ticket-confirmation',
				model: {}
			})
		).resolves.toBeUndefined();

		expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
		consoleSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Model normalization (generic `notification` alias only)
// ---------------------------------------------------------------------------

describe('notification model normalization', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		isDeliverable.mockResolvedValue(true);
	});

	/**
	 * The preheader opens with the notification's category (#645), so these
	 * assertions carry the prefix. Read from the registry rather than written
	 * out, so re-categorising `contact_form` does not fail three derivation
	 * tests that are not about categories.
	 */
	const PREFIX = `${NOTIFICATION_CATEGORIES[getNotificationType('contact_form')!.category].label} · `;

	async function sentModel(email: Record<string, unknown>) {
		await dispatchEmailOnly({ type: 'contact_form', toEmail: 'staff@example.com', email });
		return sendEmailWithTemplate.mock.calls[0][0].model;
	}

	it('derives preview_text from the first paragraph when unset', async () => {
		const model = await sentModel({
			subject: 's',
			heading: 'Reservation Cancelled',
			paragraphs: [{ text: 'Your reservation has been cancelled.' }]
		});

		expect(model.preview_text).toBe(`${PREFIX}Your reservation has been cancelled.`);
	});

	it('falls back to the heading when there are no paragraphs', async () => {
		const model = await sentModel({ subject: 's', heading: 'Reservation Cancelled' });

		expect(model.preview_text).toBe(`${PREFIX}Reservation Cancelled`);
	});

	it('does not overwrite a preview_text the caller wrote', async () => {
		const model = await sentModel({
			subject: 's',
			heading: 'h',
			preview_text: 'May 21, 10:00 AM – 11:00 AM',
			paragraphs: [{ text: 'Generic opening line.' }]
		});

		expect(model.preview_text).toBe(`${PREFIX}May 21, 10:00 AM – 11:00 AM`);
	});

	it('sets has_details only when there are rows', async () => {
		expect((await sentModel({ subject: 's', heading: 'h' })).has_details).toBe(false);

		vi.clearAllMocks();
		const withRows = await sentModel({
			subject: 's',
			heading: 'h',
			details: [{ label: 'Date', value: 'May 21' }]
		});
		expect(withRows.has_details).toBe(true);
	});

	it('escapes the quote and keeps a raw copy for the text part', async () => {
		const model = await sentModel({
			subject: 's',
			heading: 'h',
			quote: '<b>hi</b>\nsecond line'
		});

		expect(model.quote).toBe('&lt;b&gt;hi&lt;/b&gt;<br />second line');
		expect(model.quote_text).toBe('<b>hi</b>\nsecond line');
	});

	it('leaves models for other templates untouched', async () => {
		await dispatchEmailOnly({
			type: 'ticket_confirmation',
			toEmail: 'buyer@example.com',
			templateAlias: 'ticket-confirmation',
			model: { attendeeName: 'Ada' }
		});

		expect(sendEmailWithTemplate.mock.calls[0][0].model).toEqual({ attendeeName: 'Ada' });
	});
});

describe('emailOmitsUserContent', () => {
	// The rule: a direct-message email says a message is waiting, never what it
	// says. Email is the one channel blocking and reporting cannot reach — once a
	// member's words are in someone's mailbox they are there permanently.
	//
	// These assert against the DISPATCHER, deliberately. A test that only checked
	// the listener's literal would pass again the moment someone added a `quote`
	// back there, and would say nothing about the other ~22 call sites.
	beforeEach(() => {
		vi.resetAllMocks();
		isDeliverable.mockResolvedValue(true);
		getPreference.mockResolvedValue({ email: true, inApp: false, sms: false });
	});

	it('strips a quote a caller passed on a direct-message email', async () => {
		await dispatch({
			type: 'direct_message_received',
			userId: 'user-1',
			userEmail: 'user@example.com',
			title: 'Robin sent you a message',
			email: {
				subject: 'You have a new message',
				heading: 'New message',
				quote: 'the private words of a member'
			}
		});

		const model = sendEmailWithTemplate.mock.calls[0][0].model;
		expect(model.quote).toBeUndefined();
		expect(model.quote_text).toBeUndefined();
		expect(JSON.stringify(model)).not.toContain('the private words of a member');
	});

	it('does the same for a message request', async () => {
		await dispatch({
			type: 'direct_message_request',
			userId: 'user-1',
			userEmail: 'user@example.com',
			title: 'New message request',
			email: { subject: 'New request', heading: 'New request', quote: 'let me in' }
		});
		const model = sendEmailWithTemplate.mock.calls[0][0].model;
		expect(model.quote).toBeUndefined();
	});

	it('does not derive preview text from the body either', async () => {
		// preview_text is derived from the first paragraph when the caller leaves
		// it unset, which would put the message's opening line in the inbox
		// preview pane — the one place a recipient sees text without opening
		// anything.
		await dispatch({
			type: 'direct_message_received',
			userId: 'user-1',
			userEmail: 'user@example.com',
			title: 'New message',
			email: {
				subject: 'New message',
				heading: 'New message',
				paragraphs: [{ text: 'the private words of a member' }]
			}
		});
		const model = sendEmailWithTemplate.mock.calls[0][0].model;
		// The category is all that is left: it comes from the type, not the
		// member, and it is already what the subject says. Nothing of the body.
		const category =
			NOTIFICATION_CATEGORIES[getNotificationType('direct_message_received')!.category];
		expect(model.preview_text).toBe(category.label);
	});

	it('leaves other notification types alone', async () => {
		// The asymmetry is the point, not an inconsistency: a staff reply is CorvMC
		// writing, and quoting it is right.
		await dispatch({
			type: 'portal_message_reply',
			userId: 'user-1',
			userEmail: 'user@example.com',
			title: 'CorvMC replied',
			email: { subject: 'Reply', heading: 'Reply', quote: 'here is your answer' }
		});
		const model = sendEmailWithTemplate.mock.calls[0][0].model;
		expect(model.quote).toContain('here is your answer');
	});

	it('applies to dispatchEmailOnly too', async () => {
		// Same per-type policy on both routes. A rule that holds on one and not
		// the other is a rule waiting to be routed around.
		await dispatchEmailOnly({
			type: 'direct_message_received',
			toEmail: 'user@example.com',
			email: { subject: 'New message', heading: 'New message', quote: 'private' }
		});
		const model = sendEmailWithTemplate.mock.calls[0][0].model;
		expect(model.quote).toBeUndefined();
	});
});
