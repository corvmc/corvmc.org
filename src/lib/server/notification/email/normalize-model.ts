import { escapeHtmlWithBreaks } from '$lib/utils/html';
import type { NotificationEmailPayload } from '$lib/types/notification-email';

// ---------------------------------------------------------------------------
// Notification model normalization
// ---------------------------------------------------------------------------
// Applied by the dispatcher to every `notification`-alias send, so the ~19
// listeners that build a model don't each have to remember three things:
//
//  1. `preview_text` — the inbox preview snippet. Shipping it empty wastes the
//     second most valuable line of copy after the subject, and no caller was
//     setting it. Derived from the body unless the caller wrote a better one.
//  2. `has_details` — the details card wrapper has to be guarded by something
//     that is NOT the array itself: `{{#details}}` iterates in both Mustachio
//     and Handlebars, which would repeat the whole card per row.
//  3. `quote` escaping — the one field carrying user-generated text. Callers
//     pass the raw string; escaping happens here so it cannot be forgotten.
// ---------------------------------------------------------------------------

/** Postmark's preview text is truncated by mail clients well before this. */
const PREVIEW_TEXT_MAX = 140;

/**
 * Prefix every line with `>` so a mail client renders it as a quote.
 *
 * For the text-only templates, which carry no HTML and cannot fence a quoted
 * message the way `quote` does. Mustachio has no per-line transform, so this
 * has to happen before the model reaches the template. Trailing whitespace is
 * dropped from blank lines: `> ` on its own is what makes a client show an
 * empty quoted line rather than close the quote.
 */
export function quoteForPlainText(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => (line.length > 0 ? `> ${line}` : '>'))
		.join('\n');
}

function derivePreviewText(model: NotificationEmailPayload): string {
	const source = model.paragraphs?.[0]?.text ?? model.greeting ?? model.heading ?? '';
	const flat = source
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return flat.length > PREVIEW_TEXT_MAX
		? `${flat.slice(0, PREVIEW_TEXT_MAX - 1).trimEnd()}…`
		: flat;
}

export interface NormalizeOptions {
	/**
	 * Drop any member-written text before it reaches the mail server.
	 *
	 * Set from the notification type's `emailOmitsUserContent`, not by the
	 * caller. The point is that the ~23 hand-built email models across the
	 * listeners cannot get this wrong: `quote` is the one field carrying
	 * user-generated text, and this is already the one place that knows it.
	 * Dropping it here is the same argument as escaping it here.
	 */
	omitUserContent?: boolean;
}

/**
 * Fill in the derived fields the `notification` template needs.
 *
 * Idempotent, and never overwrites a `preview_text` the caller set deliberately.
 */
export function normalizeNotificationModel(
	model: NotificationEmailPayload,
	options: NormalizeOptions = {}
): Record<string, unknown> {
	const normalized: NotificationEmailPayload = {
		...model,
		preview_text: model.preview_text?.trim() || derivePreviewText(model),
		has_details: (model.details?.length ?? 0) > 0
	};

	if (options.omitUserContent) {
		// Deliberate and unconditional: a type marked emailOmitsUserContent never
		// carries member-written text, whatever the caller passed. Also clears
		// preview_text, which is derived from the body and would otherwise leak
		// the opening line into the inbox preview pane.
		delete normalized.quote;
		delete normalized.quote_text;
		normalized.preview_text = model.preview_text?.trim() || '';
	} else if (model.quote) {
		// `quote` is the only field rendered unescaped ({{{quote}}}), because the
		// line breaks have to survive as <br /> — Outlook's Word engine ignores
		// white-space:pre-wrap. Escaping it here is what makes that safe.
		normalized.quote = escapeHtmlWithBreaks(model.quote);
		normalized.quote_text = model.quote;
	}

	return normalized as unknown as Record<string, unknown>;
}
