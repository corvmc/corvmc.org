import { dispatchEmailOnly } from '$lib/server/notification/dispatcher';
import { captureException } from '$lib/server/sentry';
import type { NotificationEmailModel } from '$lib/types/notification-email';

// ---------------------------------------------------------------------------
// The two emails better-auth's password-reset flow sends
// ---------------------------------------------------------------------------
// Kept out of auth.ts so the model builders can be tested without standing up
// the auth config, and so `sendResetPassword` reads as one line there.
//
// Neither type is registered in NOTIFICATION_TYPES, deliberately. Registration
// is what makes a type a member-toggleable preference, and an account-recovery
// email is not something a member should be able to switch off — nor is the
// notice that their password changed, which is how they find out if it wasn't
// them. `type` here is only the Postmark tag.
//
// Both models pass `transactional_only`, which suppresses the shared layout's
// "you're receiving this because of your notification preferences" line. There
// is no preference behind either of these, and a member who cannot sign in
// cannot go and manage one.
// ---------------------------------------------------------------------------

/** How long a reset link stays good. Fed to better-auth as `resetPasswordTokenExpiresIn`. */
export const RESET_PASSWORD_TOKEN_TTL_SECONDS = 3600;

/**
 * Render a TTL as the phrase the email says out loud.
 *
 * Derived rather than written beside the constant so the two cannot drift —
 * an email promising an hour on a fifteen-minute token is the kind of thing
 * nobody notices until a member is locked out mid-reset.
 */
export function formatExpiry(seconds: number): string {
	if (seconds % 3600 === 0) {
		const hours = seconds / 3600;
		return hours === 1 ? '1 hour' : `${hours} hours`;
	}
	const minutes = Math.round(seconds / 60);
	return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** A greeting line, or undefined when the account has no usable name. */
function greeting(name: string | null | undefined): string | undefined {
	const trimmed = name?.trim();
	return trimmed ? `Hi ${trimmed},` : undefined;
}

export interface ResetPasswordEmailModel {
	greeting?: string;
	resetUrl: string;
	expiresIn: string;
	preview_text: string;
	transactional_only: true;
}

/**
 * The model for the `password-reset` template.
 *
 * `resetUrl` is passed through exactly as better-auth built it — it carries a
 * `?callbackURL=` query string, which is why the plaintext part of that
 * template triple-braces it.
 *
 * `preview_text` is set here rather than derived: the dispatcher only
 * normalizes models bound for the generic `notification` alias, and the shared
 * layout renders `{{preview_text}}` regardless.
 */
export function buildResetPasswordModel(params: {
	name?: string | null;
	resetUrl: string;
	ttlSeconds?: number;
}): ResetPasswordEmailModel {
	return {
		greeting: greeting(params.name),
		resetUrl: params.resetUrl,
		expiresIn: formatExpiry(params.ttlSeconds ?? RESET_PASSWORD_TOKEN_TTL_SECONDS),
		preview_text: 'Choose a new password for your CorvMC account.',
		transactional_only: true
	};
}

/** The model for the password-changed notice, on the generic `notification` alias. */
export function buildPasswordChangedModel(params: {
	name?: string | null;
}): NotificationEmailModel & { transactional_only: true } {
	return {
		subject: 'Your CorvMC password was changed',
		// Set rather than left to `normalizeNotificationModel` to derive: it would
		// take the opening 140 characters of the paragraph, and the inbox preview
		// line is worth more than the first half of a sentence.
		preview_text: 'Your password was reset and other sessions were signed out.',
		heading: 'Your password was changed',
		greeting: greeting(params.name),
		paragraphs: [
			{
				text: 'The password on your Corvallis Music Collective account was just reset, and any other sessions you had open were signed out.'
			}
		],
		footnote:
			'If you did not do this, reset your password again straight away and email contact@corvmc.org so we can help.',
		transactional_only: true
	};
}

/**
 * Send the reset link.
 *
 * `dispatchEmailOnly` hands the send to `afterResponse`, which captures any
 * failure rather than rethrowing — the request that triggered this is
 * documented to always succeed, and it must, or the response itself would say
 * whether the address exists. The try/catch here covers the model-building
 * step, which sits outside that.
 */
export async function sendPasswordResetEmail(params: {
	toEmail: string;
	name?: string | null;
	resetUrl: string;
}): Promise<void> {
	try {
		await dispatchEmailOnly({
			type: 'password_reset',
			toEmail: params.toEmail,
			templateAlias: 'password-reset',
			model: buildResetPasswordModel(params) as unknown as Record<string, unknown>
		});
	} catch (err) {
		captureException(err, { event: 'auth.password_reset', stage: 'send' });
	}
}

/** Tell the member their password changed. Same failure treatment as above. */
export async function sendPasswordChangedEmail(params: {
	toEmail: string;
	name?: string | null;
}): Promise<void> {
	try {
		await dispatchEmailOnly({
			type: 'password_changed',
			toEmail: params.toEmail,
			templateAlias: 'notification',
			model: buildPasswordChangedModel(params) as unknown as Record<string, unknown>
		});
	} catch (err) {
		captureException(err, { event: 'auth.password_changed', stage: 'send' });
	}
}
