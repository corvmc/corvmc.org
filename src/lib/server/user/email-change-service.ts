import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { session, user, verification } from '$lib/server/db/schema/authentication';
import { and, eq, gt } from 'drizzle-orm';
import { DomainError } from '../domain-error';
import { allowRateLimited } from '$lib/server/rate-limit';
import { dispatchEmailOnly } from '$lib/server/notification/dispatcher';
import {
	linkExistingSubscriberToUser,
	moveLinkedSubscriberEmail
} from '$lib/server/marketing/subscriber-service';
import { captureException } from '$lib/server/sentry';
import { stripe } from '$lib/server/stripe';
import { recordAuditEntry } from '$lib/server/audit/audit-service';

// ---------------------------------------------------------------------------
// Staff-proposed, mailbox-confirmed email change (docs/specs/staff-email-change-spec.md)
// ---------------------------------------------------------------------------
// The address is the login credential, so nothing here moves it on a staff
// member's word alone: the change applies only when the new mailbox redeems
// the link. A link needs both a valid signature and a live `verification` row,
// which is what lets Cancel (or a newer request) revoke one already sent.
// ---------------------------------------------------------------------------

/** How long a confirmation link stays good. */
export const EMAIL_CHANGE_TTL_SECONDS = 86_400;

/** Where the old address is told to write to have a change reversed. */
const STAFF_CONTACT_EMAIL = 'contact@corvmc.org';

/** Confirmation sends allowed per member per day, counting resends. */
export const EMAIL_CHANGE_SENDS_PER_DAY = 5;

/** A proposal staff can fix by typing something else; the remote shows it on the field. */
export class EmailChangeRejectedError extends DomainError {
	readonly httpStatus = 409;
}

export class EmailChangeUserNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('User not found');
	}
}

export interface PendingEmailChange {
	email: string;
	requestedAt: Date;
	expiresAt: Date;
}

export type ConfirmEmailChangeResult =
	{ status: 'changed'; email: string } | { status: 'invalid' } | { status: 'taken' };

const identifierFor = (userId: string) => `email-change:${userId}`;

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function sign(payload: string): string {
	const secret = env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error('BETTER_AUTH_SECRET is required to sign email-change links');
	return createHmac('sha256', secret).update(`email-change:${payload}`).digest('base64url');
}

export function signEmailChangeToken(userId: string, requestId: string): string {
	const payload = `${userId}:${requestId}`;
	return Buffer.from(`${payload}:${sign(payload)}`).toString('base64url');
}

export function verifyEmailChangeToken(
	token: string
): { userId: string; requestId: string } | null {
	try {
		const parts = Buffer.from(token, 'base64url').toString('utf-8').split(':');
		if (parts.length !== 3) return null;
		const [userId, requestId, signature] = parts;
		const given = Buffer.from(signature);
		const expected = Buffer.from(sign(`${userId}:${requestId}`));
		if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
		return { userId, requestId };
	} catch {
		return null;
	}
}

/** `jordan@example.com` → `j••••@example.com`: enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
	const at = email.indexOf('@');
	if (at < 1) return '••••';
	return `${email[0]}••••${email.slice(at)}`;
}

async function isTaken(email: string, exceptUserId: string): Promise<boolean> {
	const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
	return row !== undefined && row.id !== exceptUserId;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getPendingEmailChange(userId: string): Promise<PendingEmailChange | null> {
	const [row] = await db
		.select({
			email: verification.value,
			createdAt: verification.createdAt,
			expiresAt: verification.expiresAt
		})
		.from(verification)
		.where(
			and(
				eq(verification.identifier, identifierFor(userId)),
				gt(verification.expiresAt, new Date())
			)
		)
		.limit(1);
	if (!row) return null;
	return {
		email: row.email,
		requestedAt: row.createdAt ?? row.expiresAt,
		expiresAt: row.expiresAt
	};
}

/** The live request a link points at, or null for a forged, expired, used or cancelled one. */
async function findRequest(token: string) {
	const decoded = verifyEmailChangeToken(token);
	if (!decoded) return null;
	const [row] = await db
		.select({ email: verification.value })
		.from(verification)
		.where(
			and(
				eq(verification.id, decoded.requestId),
				eq(verification.identifier, identifierFor(decoded.userId)),
				gt(verification.expiresAt, new Date())
			)
		)
		.limit(1);
	return row ? { userId: decoded.userId, email: row.email } : null;
}

/** What the landing page shows. Reads only: a prefetched link must change nothing. */
export async function getEmailChangeRequest(token: string): Promise<{ email: string } | null> {
	const found = await findRequest(token);
	return found ? { email: found.email } : null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Propose a new address and mail the confirmation link to it. A second request
 * replaces the first, so only the newest link works; resending is this call
 * with the same address.
 */
export async function requestEmailChange(
	userId: string,
	rawEmail: string
): Promise<PendingEmailChange> {
	const email = normalizeEmail(rawEmail);
	const [member] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!member) throw new EmailChangeUserNotFoundError();

	if (normalizeEmail(member.email) === email) {
		throw new EmailChangeRejectedError('That is already the address on this account.');
	}
	if (await isTaken(email, userId)) {
		throw new EmailChangeRejectedError('That address already belongs to another account.');
	}
	if (!(await allowRateLimited(identifierFor(userId), EMAIL_CHANGE_SENDS_PER_DAY, 86_400))) {
		throw new EmailChangeRejectedError(
			'Too many confirmation emails for this member today. Try again tomorrow.'
		);
	}

	const requestId = crypto.randomUUID();
	const requestedAt = new Date();
	const expiresAt = new Date(requestedAt.getTime() + EMAIL_CHANGE_TTL_SECONDS * 1000);
	await db.batch([
		db.delete(verification).where(eq(verification.identifier, identifierFor(userId))),
		db.insert(verification).values({
			id: requestId,
			identifier: identifierFor(userId),
			value: email,
			expiresAt,
			createdAt: requestedAt,
			updatedAt: requestedAt
		})
	]);

	await recordAuditEntry({
		action: 'user.email_change_requested',
		subject: { type: 'user', id: userId, label: member.name },
		details: { email }
	});

	await dispatchEmailOnly({
		type: 'email_change_confirm',
		toEmail: email,
		email: {
			recipientName: member.name || undefined,
			subject: 'Confirm your new CorvMC email address',
			preview_text: 'Confirm this address to start signing in with it.',
			heading: 'Confirm your new email address',
			paragraphs: [
				{
					text: 'Corvallis Music Collective staff have asked to change the email address you sign in with to this one. Confirm it and this becomes your login; your password stays the same.'
				},
				{ text: 'The link works once, for the next 24 hours.' }
			],
			cta: {
				label: 'Confirm this address',
				url: `/confirm-email/${signEmailChangeToken(userId, requestId)}`
			},
			footnote:
				'If you did not ask us to change your address, ignore this email. Nothing changes unless you confirm.',
			transactional_only: true
		}
	});

	return { email, requestedAt, expiresAt };
}

/** Withdraw a pending request. The link already sent stops working. */
export async function cancelEmailChange(userId: string): Promise<void> {
	await db.delete(verification).where(eq(verification.identifier, identifierFor(userId)));
}

/**
 * Apply the change a link asks for. Uniqueness is checked again here because
 * the address may have been taken since staff proposed it; this check, and the
 * column's UNIQUE constraint behind it, are the authoritative ones.
 */
export async function confirmEmailChange(token: string): Promise<ConfirmEmailChangeResult> {
	const found = await findRequest(token);
	if (!found) return { status: 'invalid' };

	const [member] = await db
		.select({ name: user.name, email: user.email, stripeId: user.stripeId })
		.from(user)
		.where(eq(user.id, found.userId))
		.limit(1);
	if (!member) return { status: 'invalid' };

	const consume = db
		.delete(verification)
		.where(eq(verification.identifier, identifierFor(found.userId)));
	if (await isTaken(found.email, found.userId)) {
		await consume;
		return { status: 'taken' };
	}

	try {
		// Sessions go with the old identity, as on deactivation: the member signs
		// in again under the new address.
		await db.batch([
			db
				.update(user)
				.set({ email: found.email, emailVerified: true, updatedAt: new Date() })
				.where(eq(user.id, found.userId)),
			db.delete(session).where(eq(session.userId, found.userId)),
			consume
		]);
	} catch (err) {
		if (String(err).includes('UNIQUE')) return { status: 'taken' };
		throw err;
	}

	// Everything after the batch is best-effort: the login has already moved, and
	// a failure here must not tell the member it did not. The subscriber row is
	// moved before the claim, so an unclaimed row at the new address is merged
	// into rather than left beside the old one.
	try {
		await moveLinkedSubscriberEmail(found.userId, member.email, found.email);
	} catch (err) {
		captureException(err);
	}
	try {
		await linkExistingSubscriberToUser(found.userId, found.email);
	} catch (err) {
		captureException(err);
	}
	if (member.stripeId) {
		try {
			await stripe.customers.update(member.stripeId, { email: found.email });
		} catch (err) {
			captureException(err);
		}
	}
	await recordAuditEntry({
		action: 'user.email_changed',
		subject: { type: 'user', id: found.userId, label: member.name },
		details: { previousEmail: member.email, newEmail: found.email },
		actor: { id: found.userId, name: member.name, email: found.email }
	});

	// A notice, not a veto: nothing here undoes the change. Reversal is a staff
	// action, so the notice's one button is a message to staff asking for it.
	await dispatchEmailOnly({
		type: 'email_changed',
		toEmail: member.email,
		email: {
			recipientName: member.name || undefined,
			subject: 'Your CorvMC email address was changed',
			heading: 'Your email address was changed',
			paragraphs: [
				{
					text: `The address you sign in to the Corvallis Music Collective with is now ${maskEmail(found.email)}. The change was requested by CMC staff and confirmed from the new mailbox.`
				},
				{
					text: `If you did not ask for this, email CMC staff at ${STAFF_CONTACT_EMAIL} from this address and we will change it back. The button below starts that email for you.`
				}
			],
			cta: {
				label: 'Ask staff to reverse this change',
				url: `mailto:${STAFF_CONTACT_EMAIL}?subject=${encodeURIComponent('Please reverse the email change on my CorvMC account')}`
			},
			footnote: 'Until staff reverse it, you cannot sign in with this address.',
			transactional_only: true
		}
	});

	return { status: 'changed', email: found.email };
}
