import { env } from '$env/dynamic/private';
import type {
	NotificationEmailContent,
	NotificationEmailModel
} from '$lib/types/notification-email';

// ---------------------------------------------------------------------------
// Notification model construction
// ---------------------------------------------------------------------------
// Turns what a sender declared into the model the generic template renders.
// The sender says what happened; this decides how CorvMC mail reads — the
// greeting, where a button points, and which fields the template is owed.
// `normalizeNotificationModel` runs after it and derives the rest.
// ---------------------------------------------------------------------------

const FALLBACK_SITE_URL = 'https://corvmc.org';

/** True for anything already carrying a scheme — `https:`, `mailto:`, Stripe's links. */
function isAbsolute(url: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/**
 * A button URL a mail client can follow.
 *
 * The site-relative paths listeners hand the notification bell are dead links
 * in a mailbox, so the origin is applied here rather than interpolated into
 * ~30 call sites that each had to remember it.
 */
function absoluteUrl(url: string): string {
	if (isAbsolute(url)) return url;
	const origin = env.PUBLIC_SITE_URL ?? FALLBACK_SITE_URL;
	return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

export interface BuildOptions {
	/** The in-app row's link. A CTA with no URL of its own points here. */
	href?: string;
}

/**
 * Build the generic template's model from declared content.
 *
 * A CTA whose URL resolves to nothing is dropped rather than rendered as a
 * button that goes nowhere; `StandaloneEmailContent` is what stops that
 * happening on the one path with no `href` to fall back on.
 */
export function buildNotificationEmail(
	content: NotificationEmailContent,
	options: BuildOptions = {}
): NotificationEmailModel {
	const { recipientName, cta, ...rest } = content;
	const target = cta?.url ?? options.href;

	return {
		...rest,
		...(recipientName ? { greeting: `Hi ${recipientName},` } : {}),
		...(cta && target ? { cta: { url: absoluteUrl(target), label: cta.label } } : {})
	};
}
