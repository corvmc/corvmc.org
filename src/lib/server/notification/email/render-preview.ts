// ---------------------------------------------------------------------------
// Local renderer for the Postmark templates
// ---------------------------------------------------------------------------
// Postmark renders these templates with Mustachio on their servers, so there is
// normally no way to see one without pushing it. This renders them locally with
// Handlebars, which covers the exact subset the templates use: plain variables,
// triple-brace raw output, `each` loops, truthy sections and inverted sections.
//
// Mustachio accepts both `each`-style and bare-name section loops; Handlebars
// only accepts `each`, so the templates use `each` throughout and one file
// renders correctly in both engines.
//
// This is a dev/test tool — it reads from the filesystem and is never imported
// by the Worker. `scripts/email-validate.ts` is the authoritative check, since
// it runs the real Mustachio via Postmark's validate endpoint.
// ---------------------------------------------------------------------------

import Handlebars from 'handlebars';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATE_ROOT = 'postmark/templates';

/** The layout's content-injection tag, which Handlebars can't parse (`@` is reserved). */
const CONTENT_TAG = '{{{@content}}}';

/**
 * Stand-in for CONTENT_TAG while the layout is compiled. Deliberately an HTML
 * comment with no braces — anything mustache-shaped would just be parsed again.
 */
const CONTENT_SENTINEL = '<!--CORVMC_EMAIL_CONTENT-->';

interface TemplateMeta {
	Name: string;
	Alias: string;
	Subject?: string;
	TemplateType: 'Standard' | 'Layout';
	/**
	 * `null` means "detached", and is written out explicitly rather than omitted.
	 * `postmark templates push` only *sets* the keys present in meta.json — an
	 * absent one leaves whatever the server already had, so a template that drops
	 * its content.html keeps rendering the old layout around an empty HtmlBody.
	 * That is a blank branded email, and it is why these are stated, not implied.
	 */
	LayoutTemplate?: string | null;
}

export interface RenderedTemplate {
	html: string;
	text: string;
	subject: string;
}

function templateDir(alias: string): string {
	return join(TEMPLATE_ROOT, alias);
}

function layoutDir(alias: string): string {
	return join(TEMPLATE_ROOT, '_layouts', alias);
}

export function readMeta(alias: string): TemplateMeta {
	return JSON.parse(readFileSync(join(templateDir(alias), 'meta.json'), 'utf8'));
}

// Mustache renders `{{#name}}…{{/name}}` for a truthy scalar once, keeping the
// enclosing context on the stack, so `{{name}}` inside the block still resolves.
// Handlebars instead makes the scalar itself the context, where `{{name}}` finds
// nothing and the block renders empty. Restore the Mustache behaviour so the
// preview matches what Postmark actually produces.
Handlebars.registerHelper('blockHelperMissing', function (this: unknown, context, options) {
	if (context === true) return options.fn(this);
	if (context === false || context == null) return options.inverse(this);
	if (Array.isArray(context)) {
		return context.length > 0
			? context.map((item) => options.fn(item)).join('')
			: options.inverse(this);
	}
	// Objects get scoped as usual; scalars keep the parent context.
	return options.fn(typeof context === 'object' ? context : this);
});

function compile(source: string, model: object): string {
	return Handlebars.compile(source)(model);
}

/**
 * Render a template by alias, wrapped in its layout, as Postmark would.
 *
 * The layout's content tag is substituted *after* the layout is compiled, so
 * rendered template output is never re-processed as Handlebars source.
 *
 * A template directory with no `content.html` is a text-only template: Postmark
 * sends it with an empty HtmlBody, so the rendered `html` here is `''` too.
 */
export function renderTemplate(alias: string, model: Record<string, unknown>): RenderedTemplate {
	const meta = readMeta(alias);
	const dir = templateDir(alias);

	const htmlPath = join(dir, 'content.html');
	const innerHtml = existsSync(htmlPath) ? compile(readFileSync(htmlPath, 'utf8'), model) : '';
	const innerText = compile(readFileSync(join(dir, 'content.txt'), 'utf8'), model);
	const subject = meta.Subject ? compile(meta.Subject, model) : '';

	if (!meta.LayoutTemplate) {
		return { html: innerHtml, text: innerText, subject };
	}

	const ldir = layoutDir(meta.LayoutTemplate);
	const wrap = (file: string, inner: string) =>
		compile(
			readFileSync(join(ldir, file), 'utf8').replaceAll(CONTENT_TAG, CONTENT_SENTINEL),
			model
		).replaceAll(CONTENT_SENTINEL, inner);

	return {
		// Wrapping an empty body would manufacture an HTML part Postmark never sends.
		html: innerHtml ? wrap('content.html', innerHtml) : '',
		text: wrap('content.txt', innerText),
		subject
	};
}
