/**
 * Assert every template on Postmark matches `postmark/templates/`.
 *
 * A clean `email:push` is not evidence: `password-reset`, `verify-email` and
 * `band-reply` were absent for weeks while the code sent them. Only reading
 * the server back catches that. Run: pnpm email:verify. See #1126.
 */

import 'dotenv/config';
import { ServerClient } from 'postmark';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const token = process.env.POSTMARK_SERVER_TOKEN;
if (!token) {
	console.error('POSTMARK_SERVER_TOKEN is not set.');
	process.exit(1);
}

const client = new ServerClient(token);
const ROOT = 'postmark/templates';

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function localBodies(dir: string) {
	const read = (f: string) =>
		existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null;
	return { html: read('content.html'), text: read('content.txt') };
}

/** `_layouts/` holds layouts, which push as templates but live under their own alias. */
function aliases(): { alias: string; dir: string }[] {
	const out = readdirSync(ROOT, { withFileTypes: true })
		.filter((e) => e.isDirectory() && e.name !== '_layouts')
		.map((e) => ({ alias: e.name, dir: join(ROOT, e.name) }));

	const layouts = join(ROOT, '_layouts');
	if (existsSync(layouts)) {
		for (const e of readdirSync(layouts, { withFileTypes: true })) {
			if (e.isDirectory()) out.push({ alias: e.name, dir: join(layouts, e.name) });
		}
	}
	return out;
}

let failed = 0;

for (const { alias, dir } of aliases()) {
	const local = localBodies(dir);

	let live;
	try {
		live = await client.getTemplate(alias);
	} catch {
		console.error(`✗ ${alias} — not on the server`);
		failed++;
		continue;
	}

	const problems: string[] = [];
	if (local.html !== null && norm(local.html) !== norm(live.HtmlBody)) problems.push('HtmlBody');
	if (local.text !== null && norm(local.text) !== norm(live.TextBody)) problems.push('TextBody');
	// A template the repo has converted to text-only keeps its old HTML on the
	// server unless something notices. This is that something.
	if (local.html === null && norm(live.HtmlBody))
		problems.push('HtmlBody present on server but not in the repo');

	if (problems.length) {
		console.error(`✗ ${alias} — ${problems.join(', ')}`);
		failed++;
	} else {
		console.log(`✓ ${alias}`);
	}
}

if (failed) {
	console.error(`\n${failed} template(s) differ from the repo. Run \`pnpm email:push\`.`);
	process.exit(1);
}
console.log('\nEvery template on Postmark matches the repo.');
