import { queueEmail, queueEmails } from '#lib/server/outbox/outbox-service.js';
import type { TemplatedEmail } from './email/postmark-client';
import { buildNotificationEmail } from './email/build-model';
import { normalizeNotificationModel } from './email/normalize-model';
import { NOTIFICATION_TYPES } from '#lib/server/db/schema/notification.js';
import { NOTIFICATION_CATEGORIES } from '#lib/email/notification-category.js';
import { createNotification, createNotifications } from './in-app-service';
import { getPreference } from './preference-service';
import { isDeliverable, listBatchRecipients } from './recipient';
import { pushToUser } from './sse';
import { captureException } from '#lib/server/sentry.js';
import type {
	NotificationEmailContent,
	NotificationEmailPayload,
	StandaloneEmailContent
} from '#lib/types/notification-email.js';

// ---------------------------------------------------------------------------
// Notification dispatcher
// ---------------------------------------------------------------------------
// Routes a notification to the channels a member's preferences allow. It knows
// about delivery, not about copy: callers declare what happened as an
// `email` content object and the email layer builds the model from it
// (`build-model.ts`, then `normalize-model.ts`).
//
// A type that needs its own Postmark template rather than the generic one goes
// through `dispatchEmailOnly`, which takes an alias and a model of its own.
// ---------------------------------------------------------------------------

/** The generic template every declared notification renders through. */
const GENERIC_ALIAS = 'notification';

/**
 * Looked up from the registry rather than passed by the caller: whether a
 * notification may quote a member is a property of what kind of notification it
 * is, which is where every other per-type policy already lives.
 */
function omitsUserContent(type: string): boolean | undefined {
	return NOTIFICATION_TYPES.find((t) => t.key === type)?.emailOmitsUserContent;
}

/**
 * Same argument as `omitsUserContent`: which bucket a notification falls in is a
 * property of its type, not something ~40 call sites should each restate. An
 * unregistered type simply renders no bar.
 */
function categoryOf(type: string) {
	const def = NOTIFICATION_TYPES.find((t) => t.key === type);
	return def && NOTIFICATION_CATEGORIES[def.category];
}

/** Declared content → the model Postmark's generic template wants. */
function genericModel(
	content: NotificationEmailContent,
	type: string,
	href?: string
): Record<string, unknown> {
	return normalizeNotificationModel(
		buildNotificationEmail(content, { href }) as NotificationEmailPayload,
		{ omitUserContent: omitsUserContent(type), category: categoryOf(type) }
	);
}

/** A dedicated template's own model, normalized only if it is aimed at the generic one. */
function templateModel(
	alias: string,
	model: Record<string, unknown>,
	type: string
): Record<string, unknown> {
	return alias === GENERIC_ALIAS
		? normalizeNotificationModel(model as unknown as NotificationEmailPayload, {
				omitUserContent: omitsUserContent(type),
				category: categoryOf(type)
			})
		: model;
}

export interface DispatchParams {
	/** The notification type key (from schema/notification.ts) */
	type: string;
	/** Target user */
	userId: string;
	userEmail: string;
	/** In-app notification content */
	title: string;
	body?: string;
	href?: string;
	data?: Record<string, unknown>;
	/** What the email says. Absent, no email is sent whatever the preference. */
	email?: NotificationEmailContent;
	/** Override: send email even if no userId (e.g., ticket buyer without account) */
	forceEmail?: boolean;
}

/**
 * Dispatch a notification through enabled channels.
 * Checks user preferences, creates in-app notification, sends email,
 * and pushes SSE event. Fire-and-forget — errors are logged, not thrown.
 *
 * The in-app row is written on the request path because the recipient may be
 * looking at the bell when it lands; the email goes to the outbox, which
 * sends it after the response and retries it if Postmark refuses.
 */
export async function dispatch(params: DispatchParams): Promise<void> {
	// A removed account is not a recipient, on any channel. Guarded at the seam
	// rather than in each fan-out, so a sender written next year inherits it —
	// the lists feeding this are roster reads and any of them can go stale.
	//
	// Mail a removal itself owes — a confirmation that the account is closed —
	// goes through `dispatchEmailOnly`, which is the accountless path and is
	// deliberately not guarded here. Nor is a `forceEmail` send with no userId,
	// which has no account to check.
	if (params.userId && !(await isDeliverable(params.userId))) return;

	const pref = await getPreference(params.userId, params.type);

	// In-app notification
	if (pref.inApp) {
		try {
			const row = await createNotification({
				userId: params.userId,
				type: params.type,
				title: params.title,
				body: params.body,
				href: params.href,
				data: params.data
			});

			// Push via SSE for real-time delivery
			pushToUser(params.userId, {
				id: row.id,
				type: row.type,
				title: row.title,
				body: row.body,
				href: row.href,
				createdAt: row.createdAt.toISOString()
			});
		} catch (err) {
			captureException(err, { channel: 'in-app', type: params.type, userId: params.userId });
		}
	}

	const content = params.email;
	if ((pref.email || params.forceEmail) && content) {
		await enqueue(
			() =>
				queueEmail({
					to: params.userEmail,
					templateAlias: GENERIC_ALIAS,
					model: genericModel(content, params.type, params.href),
					tag: params.type
				}),
			{ channel: 'email', type: params.type }
		);
	}
}

/** Declared content as an outbox email, for a caller that inserts the row in its own batch. */
export function standaloneEmail(
	type: string,
	to: string,
	email: StandaloneEmailContent
): TemplatedEmail {
	return { to, templateAlias: GENERIC_ALIAS, model: genericModel(email, type), tag: type };
}

/** Into the outbox. A notification never fails its caller, so a refused insert is reported, not thrown. */
async function enqueue(queue: () => Promise<unknown>, tags: Record<string, unknown>) {
	try {
		await queue();
	} catch (err) {
		captureException(err, tags);
	}
}

/**
 * What an email-only send renders through: declared content on the generic
 * template, or a dedicated template and the model that template expects.
 */
type EmailOnlyBody =
	| { email: StandaloneEmailContent; templateAlias?: never; model?: never }
	| { email?: never; templateAlias: string; model: Record<string, unknown> };

/**
 * Dispatch to a recipient who may not have an account (e.g., ticket buyer).
 * Sends email only — no in-app notification or SSE.
 */
export async function dispatchEmailOnly(
	params: {
		type: string;
		toEmail: string;
		/** Set when the recipient is expected to reply — see SendTemplateParams. */
		replyTo?: string | null;
	} & EmailOnlyBody
): Promise<void> {
	const alias = params.email ? GENERIC_ALIAS : params.templateAlias;
	// Same per-type policy as dispatch(): this path takes a `type` too, and
	// leaving it out would make the rule hold on one route and not the other.
	const model = params.email
		? genericModel(params.email, params.type)
		: templateModel(params.templateAlias, params.model, params.type);

	await enqueue(
		() =>
			queueEmail({
				to: params.toEmail,
				templateAlias: alias,
				model,
				replyTo: params.replyTo,
				tag: params.type
			}),
		{ channel: 'email-only', type: params.type }
	);
}

/**
 * `dispatchEmailOnly` for many recipients of one type, as Postmark batch calls
 * of 500 rather than one subrequest each. Same generic template and per-type
 * policy, so a message reads the same whichever path sent it.
 */
export async function dispatchEmailOnlyBatch(
	type: string,
	messages: { toEmail: string; email: StandaloneEmailContent }[]
): Promise<void> {
	if (messages.length === 0) return;
	const batch = messages.map((m) => ({
		to: m.toEmail,
		templateAlias: GENERIC_ALIAS,
		model: genericModel(m.email, type),
		tag: type
	}));
	await enqueue(() => queueEmails(batch), { channel: 'email-only-batch', type });
}

/**
 * `dispatch` for many members and one message: the same preference and
 * removed-account rules, but one recipient query, batched in-app inserts and
 * Postmark batch calls of 500, so a roster-sized send is a handful of
 * subrequests rather than several per member.
 */
export async function dispatchBatch(params: {
	type: string;
	userIds: string[];
	title: string;
	body?: string;
	href?: string;
	data?: Record<string, unknown>;
	/** Shared by every recipient; the greeting is added per member. */
	email?: Omit<NotificationEmailContent, 'recipientName'>;
}): Promise<void> {
	if (params.userIds.length === 0) return;
	const recipients = await listBatchRecipients(params.userIds, params.type);

	const inApp = recipients.filter((r) => r.inAppEnabled);
	if (inApp.length > 0) {
		try {
			await createNotifications(
				inApp.map((r) => ({
					userId: r.userId,
					type: params.type,
					title: params.title,
					body: params.body,
					href: params.href,
					data: params.data
				}))
			);
			// The rows carry no ids back; the bell re-fetches on any message.
			const createdAt = new Date().toISOString();
			for (const r of inApp) {
				pushToUser(r.userId, {
					id: `${params.type}:${r.userId}`,
					type: params.type,
					title: params.title,
					body: params.body ?? null,
					href: params.href ?? null,
					createdAt
				});
			}
		} catch (err) {
			captureException(err, { channel: 'in-app-batch', type: params.type });
		}
	}

	const content = params.email;
	const byEmail = content ? recipients.filter((r) => r.emailEnabled) : [];
	if (content && byEmail.length > 0) {
		const batch = byEmail.map((r) => ({
			to: r.email,
			templateAlias: GENERIC_ALIAS,
			model: genericModel({ ...content, recipientName: r.name }, params.type, params.href),
			tag: params.type
		}));
		await enqueue(() => queueEmails(batch), { channel: 'email-batch', type: params.type });
	}
}
