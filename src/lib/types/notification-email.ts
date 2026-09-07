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
