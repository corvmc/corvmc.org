#!/usr/bin/env node
/**
 * Class census — measures how much raw Tailwind/daisyUI sits in templates.
 *
 * The template audit (docs/development/template-audit.md) is a migration of
 * repeated class strings into components and semantic utilities. That only
 * stays honest if each phase can show its number moving, so this script is the
 * scoreboard: run it before and after a phase and record the delta.
 *
 *   node scripts/class-census.mjs           # human report
 *   node scripts/class-census.mjs --json    # machine-readable totals
 *   node scripts/class-census.mjs --top 40  # how many repeats to list
 *
 * Only *literal* `class="…"` attributes are counted. A dynamic `class={expr}`
 * is invisible here, which is deliberate — the goal is to remove hand-written
 * class soup, and an expression is usually a component already doing its job.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const SCOPES = [
	{ key: 'routes', label: 'src/routes', dir: 'src/routes' },
	{ key: 'components', label: 'src/lib/components', dir: 'src/lib/components' }
];

/** Storybook stories and test harnesses are fixtures, not shipped UI. */
const EXCLUDE = /\.(stories|test)\.svelte$/;
const HARNESS = /Harness\.svelte$/;

/**
 * daisyUI *component* classes. Split out from raw utilities because they are
 * not the problem in the same way: `btn` is a design-system token, `mt-4` is a
 * decision made in a template.
 */
const DAISY = new Set(
	`alert avatar badge breadcrumbs btn card chat checkbox collapse countdown diff divider drawer
	 dropdown fieldset file-input footer hero indicator input join kbd label link loading mask menu
	 modal navbar pagination progress radial-progress radio range rating select skeleton stat stats
	 status steps swap tab table textarea timeline toast toggle tooltip validator`.split(/\s+/)
);
const isDaisy = (t) => {
	if (DAISY.has(t)) return true;
	const base = t.replace(/^(hover|focus|active|sm|md|lg|xl|@sm|@md|@lg):/, '');
	for (const d of DAISY) if (base === d || base.startsWith(`${d}-`)) return true;
	return false;
};

function walk(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (entry.endsWith('.svelte') && !EXCLUDE.test(entry) && !HARNESS.test(entry))
			out.push(full);
	}
	return out;
}

function census(dir) {
	const files = walk(join(ROOT, dir));
	const perFile = [];
	const strings = new Map();
	const tokens = new Map();
	const styles = new Map();
	let lines = 0,
		attrs = 0,
		tokenCount = 0,
		dynamic = 0,
		inlineStyles = 0;

	for (const file of files) {
		const src = readFileSync(file, 'utf8');
		let fileTokens = 0,
			fileAttrs = 0;
		lines += src.split('\n').length;
		dynamic += (src.match(/class=\{/g) ?? []).length;

		for (const [, value] of src.matchAll(/class="([^"]*)"/g)) {
			const list = value.split(/\s+/).filter(Boolean);
			if (!list.length) continue;
			fileAttrs++;
			fileTokens += list.length;
			if (list.length > 1) strings.set(value, (strings.get(value) ?? 0) + 1);
			for (const t of list) tokens.set(t, (tokens.get(t) ?? 0) + 1);
		}
		for (const [, value] of src.matchAll(/style="([^"]*)"/g)) {
			inlineStyles++;
			styles.set(value, (styles.get(value) ?? 0) + 1);
		}
		attrs += fileAttrs;
		tokenCount += fileTokens;
		perFile.push({ file: relative(ROOT, file), tokens: fileTokens, attrs: fileAttrs });
	}

	let daisyTokens = 0;
	for (const [t, n] of tokens) if (isDaisy(t)) daisyTokens += n;

	return {
		files: files.length,
		lines,
		attrs,
		tokens: tokenCount,
		dynamic,
		inlineStyles,
		daisyTokens,
		rawTokens: tokenCount - daisyTokens,
		perFile: perFile.sort((a, b) => b.tokens - a.tokens),
		strings: [...strings].sort((a, b) => b[1] - a[1]),
		tokenList: [...tokens].sort((a, b) => b[1] - a[1]),
		styleList: [...styles].sort((a, b) => b[1] - a[1])
	};
}

const argv = process.argv.slice(2);
const top = Number(argv[argv.indexOf('--top') + 1]) || 25;
const results = Object.fromEntries(SCOPES.map((s) => [s.key, census(s.dir)]));

if (argv.includes('--json')) {
	const slim = Object.fromEntries(
		Object.entries(results).map(([k, v]) => [
			k,
			{
				files: v.files,
				lines: v.lines,
				attrs: v.attrs,
				tokens: v.tokens,
				daisyTokens: v.daisyTokens,
				rawTokens: v.rawTokens,
				inlineStyles: v.inlineStyles
			}
		])
	);
	console.log(JSON.stringify(slim, null, 2));
	process.exit(0);
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const row = (c) => c.map((x, i) => String(x).padEnd(i === 0 ? 20 : 14)).join('');

console.log('\nCLASS CENSUS\n');
console.log(row(['scope', 'files', 'lines', 'class attrs', 'tokens', 'tok/line', 'inline style']));
for (const s of SCOPES) {
	const r = results[s.key];
	console.log(
		row([
			s.label,
			r.files,
			r.lines,
			r.attrs,
			r.tokens,
			(r.tokens / r.lines).toFixed(2),
			r.inlineStyles
		])
	);
}

const total = results.routes.tokens + results.components.tokens;
console.log(
	`\n  ${pct(results.routes.tokens, total)} of all class tokens live in route templates.`
);
for (const s of SCOPES) {
	const r = results[s.key];
	console.log(
		`  ${s.label}: ${r.rawTokens} raw utilities (${pct(r.rawTokens, r.tokens)}) vs ${r.daisyTokens} daisyUI component classes.`
	);
}

for (const s of SCOPES) {
	const r = results[s.key];
	const repeats = r.strings.filter(([, n]) => n >= 3);
	const covered = repeats.reduce((a, [, n]) => a + n, 0);
	console.log(
		`\n── ${s.label}: top repeated class strings (${repeats.length} repeat 3+ times, ${covered} occurrences) ──`
	);
	for (const [str, n] of r.strings.slice(0, top)) {
		if (n < 3) break;
		console.log(`  ${String(n).padStart(4)}  ${str}`);
	}
}

console.log(`\n── src/routes: worst offenders by class token count ──`);
for (const f of results.routes.perFile.slice(0, 12)) {
	console.log(
		`  ${String(f.tokens).padStart(4)}  (${String(f.attrs).padStart(3)} attrs)  ${f.file}`
	);
}

console.log(`\n── src/routes: most common inline styles ──`);
for (const [str, n] of results.routes.styleList.slice(0, 8)) {
	console.log(`  ${String(n).padStart(4)}  ${str}`);
}
console.log();
