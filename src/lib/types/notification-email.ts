// Model for the generic `notification` Postmark template.
// One template renders every transactional notification; listeners supply
// the copy (subject, heading, body, details, CTA) as this model. The email
// body/subject therefore live in app code, not in Postmark.

export interface NotificationEmailDetail {
	label: string;
	value: string;
}

export interface NotificationEmailCta {
	url: string;
	label: string;
}

export interface NotificationEmailModel {
	/** Email subject line (rendered by the template's `{{subject}}`) */
	subject: string;
	/**
	 * Hidden preview text shown in the inbox list beside the subject.
	 * Left unset, `normalizeNotificationModel` derives one from the body.
	 */
	preview_text?: string;
	/** Display headline at the top of the body */
	heading: string;
	/** Optional greeting line, e.g. "Hi Ada," */
	greeting?: string;
	/** Body paragraphs, rendered in order. Plain text — the template escapes HTML. */
	paragraphs?: { text: string }[];
	/** Optional rows for the "details" card. Plain text — the template escapes HTML. */
	details?: NotificationEmailDetail[];
	/**
	 * Optional block of user-generated text, rendered in a callout box.
	 *
	 * Pass the **raw** string. `normalizeNotificationModel` escapes it and
	 * converts newlines to `<br />`, so callers cannot forget to escape it.
	 */
	quote?: string;
	/** Optional call-to-action button */
	cta?: NotificationEmailCta;
	/** Optional small footnote below the body */
	footnote?: string;
	/**
	 * Suppress the shared layout's "you're receiving this because of your
	 * notification preferences" line.
	 *
	 * Set it on mail that no preference governs — password reset, the notice
	 * that a password changed — where the line is both untrue and, for a member
	 * who cannot sign in, unactionable. Absent, the line renders as it always has.
	 */
	transactional_only?: boolean;
}

/**
 * The shape actually sent to Postmark: `NotificationEmailModel` plus the fields
 * `normalizeNotificationModel` derives, which the templates need but callers
 * should never have to set.
 */
export interface NotificationEmailPayload extends NotificationEmailModel {
	/** True when `details` is a non-empty array — guards the card wrapper. */
	has_details?: boolean;
	/** Plain-text counterpart of `quote`, for the text/plain part. */
	quote_text?: string;
}

/** A button whose URL the email layer may supply. See `NotificationEmailContent.cta`. */
export interface NotificationEmailCtaSpec {
	label: string;
	/** Absolute URL, or a site-relative path the email layer makes absolute. */
	url?: string;
}

/**
 * What a notification says, as its sender declares it.
 *
 * The half of `NotificationEmailModel` that is a decision about this
 * notification. Everything else on that model — the greeting, the absolute CTA
 * URL, the preview text, the derived flags — is a decision about how CorvMC
 * mail reads, and `buildNotificationEmail` makes it once for all of them.
 */
export interface NotificationEmailContent {
	/**
	 * Who it is addressed to. The email layer writes the greeting from it, so
	 * every notification greets the same way. Omit when there is no name to use.
	 */
	recipientName?: string;
	/** Subject line. Required: it is the most-read copy in the mail. */
	subject: string;
	/** Inbox preview snippet. Derived from the first paragraph when unset. */
	preview_text?: string;
	heading: string;
	paragraphs?: { text: string }[];
	details?: NotificationEmailDetail[];
	/** Raw member-written text. Escaped, and dropped for types that must not carry it. */
	quote?: string;
	footnote?: string;
	transactional_only?: boolean;
	/**
	 * The button. Its URL defaults to the notification's own `href`, so the bell
	 * row and the email button lead to the same place unless one says otherwise.
	 */
	cta?: NotificationEmailCtaSpec;
}

/**
 * Content for mail with no in-app row: there is no `href` to fall back on, so a
 * button has to name its own URL.
 */
export interface StandaloneEmailContent extends NotificationEmailContent {
	cta?: NotificationEmailCta;
}
