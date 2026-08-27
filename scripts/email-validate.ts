/**
 * Validate every template against Postmark's real Mustachio engine.
 *
 * Run: pnpm email:validate
 *
 * Reads POSTMARK_SERVER_TOKEN from .env (or the environment, which wins).
 *
 * `validateTemplate` renders without sending — it reports syntax errors and
 * any model field the template references but the fixture does not supply.
 * This is the authoritative check; the local Handlebars renderer used by
 * `pnpm email:preview` is only an approximation.
 *
 * Run this before every `pnpm email:push`.
 */
import 'dotenv/config';
import { ServerClient } from 'postmark';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES } from '../src/lib/server/notification/email/fixtures';
import { readMeta } from '../src/lib/server/notification/email/render-preview';

const token = process.env.POSTMARK_SERVER_TOKEN;
if (!token) {
	console.error(
		'POSTMARK_SERVER_TOKEN is not set.\n' +
			'Add it to .env, or pass it inline:\n' +
			'  POSTMARK_SERVER_TOKEN=<token> pnpm email:validate'
	);
	process.exit(1);
}

const client = new ServerClient(token);
const root = 'postmark/templates';
let failed = 0;

/**
 * Run one validate call and report it.
 *
 * Note the layout is checked on its own rather than via `LayoutTemplate`: that
 * field takes the *alias* of a layout already stored on the server, so using it
 * would make validation depend on a prior `email:push` — exactly backwards. The
 * layout and each template are valid Mustachio independently, which is what we
 * need to know before pushing anything.
 */
async function validate(
	label: string,
	body: Parameters<typeof client.validateTemplate>[0],
	model: Record<string, unknown>
): Promise<void> {
	let result: Awaited<ReturnType<typeof client.validateTemplate>>;
	try {
		result = await client.validateTemplate(body);
	} catch (err) {
		failed++;
		console.error(`✗ ${label}\n    API error: ${(err as Error).message}`);
		return;
	}

	const parts = [
		['Subject', result.Subject],
		['HtmlBody', result.HtmlBody],
		['TextBody', result.TextBody]
	] as const;

	const errors = parts.flatMap(([name, part]) =>
		part && part.ContentIsValid === false
			? (part.ValidationErrors ?? []).map((e) => `${name}: ${e.Message} (line ${e.Line})`)
			: []
	);

	if (errors.length > 0) {
		failed++;
		console.error(`✗ ${label}`);
		for (const e of errors) console.error(`    ${e}`);
		return;
	}

	// Fields the template references but the model never supplied — usually a typo.
	const suggested = (result.SuggestedTemplateModel ?? {}) as Record<string, unknown>;
	const unsupplied = Object.keys(suggested).filter((k) => !(k in model));

	console.log(`✓ ${label}${unsupplied.length ? ` — unsupplied: ${unsupplied.join(', ')}` : ''}`);
}

// --- Layouts ---
const layoutAliases = [...new Set(FIXTURES.map((f) => readMeta(f.alias).LayoutTemplate))].filter(
	(a): a is string => Boolean(a)
);

for (const alias of layoutAliases) {
	const dir = join(root, '_layouts', alias);
	// The layout renders `{{{@content}}}`, which only resolves when Postmark
	// composes it with a template — substitute a marker so it validates alone.
	const model = { preview_text: 'Preview text sample' };
	await validate(
		`layout: ${alias}`,
		{
			Subject: '',
			HtmlBody: readFileSync(join(dir, 'content.html'), 'utf8'),
			TextBody: readFileSync(join(dir, 'content.txt'), 'utf8'),
			TemplateType: 'Layout',
			TestRenderModel: model
		},
		model
	);
}

// --- Templates ---
for (const fixture of FIXTURES) {
	const meta = readMeta(fixture.alias);
	const dir = join(root, fixture.alias);

	// A template dir with no content.html is text-only — Postmark accepts a blank
	// HtmlBody as long as the TextBody is non-empty.
	const htmlPath = join(dir, 'content.html');

	await validate(
		`${fixture.name} (${fixture.alias})`,
		{
			Subject: meta.Subject ?? '',
			HtmlBody: existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '',
			TextBody: readFileSync(join(dir, 'content.txt'), 'utf8'),
			TemplateType: 'Standard',
			TestRenderModel: fixture.model
		},
		fixture.model
	);
}

// --- Layout attachment, as it actually is on the server ---
//
// Everything above validates the local files. This checks the one piece of
// template state the files cannot assert on their own: which layout, if any,
// Postmark has attached to each alias.
//
// It matters because `postmark templates push` only *sets* the keys present in
// meta.json. Removing `LayoutTemplate` does not detach anything — the server
// keeps the old value. A template that has since lost its content.html then
// renders as the layout wrapped around an empty HtmlBody, which is a fully
// branded email with nothing inside it. Mail clients prefer the HTML part, so
// that is what the recipient reads. Nothing else in this script would notice.
for (const alias of [...new Set(FIXTURES.map((f) => f.alias))]) {
	// `|| null`, not `?? null`: absent, null and '' all mean detached. Postmark
	// reports a detached template as null and accepts only '' to detach one, so
	// the two spellings have to compare equal or this reports drift that isn't.
	const expected = readMeta(alias).LayoutTemplate || null;

	let actual: string | null;
	try {
		actual = (await client.getTemplate(alias)).LayoutTemplate || null;
	} catch (err) {
		// Not yet pushed is not a failure — this runs *before* email:push.
		console.log(`· layout attachment: ${alias} — not on the server yet`);
		if (!(err as { code?: number }).code) throw err;
		continue;
	}

	if (actual === expected) {
		console.log(`✓ layout attachment: ${alias} → ${actual ?? 'none'}`);
		continue;
	}

	failed++;
	// email:push cannot fix a stale *attachment*. The CLI sends only the keys it
	// considers set, and it treats a null/empty LayoutTemplate as unset — it
	// reports "Layout used: None" and pushes everything except that. Postmark's
	// API ignores `null` here too. An empty string is the one thing that detaches.
	console.error(
		`✗ layout attachment: ${alias}\n` +
			`    meta.json says ${expected ?? 'none'}, server has ${actual ?? 'none'}.\n` +
			(expected === null
				? `    email:push will NOT fix this — neither the CLI nor the API acts on a\n` +
					`    null layout. Detach it with an empty string:\n` +
					`      curl -X PUT https://api.postmarkapp.com/templates/${alias} \\\n` +
					`        -H "X-Postmark-Server-Token: $POSTMARK_SERVER_TOKEN" \\\n` +
					`        -H "Content-Type: application/json" -d '{"LayoutTemplate": ""}'`
				: `    Run email:push, or set it in the Postmark UI (Templates → ${alias} → Layout).`)
	);
}

if (failed > 0) {
	console.error(`\n${failed} template(s) failed validation.`);
	process.exit(1);
}
console.log('\nAll templates valid.');
