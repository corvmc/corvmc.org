#!/usr/bin/env node
/**
 * UI string census — counts interface copy typed as literals in `.svelte` (#2099).
 *
 *   node scripts/ui-string-census.mjs          # report by directory and file
 *   node scripts/ui-string-census.mjs --json   # machine-readable totals
 *
 * Runs `custom/no-literal-ui-text` alone over shipped components and routes;
 * test harnesses and fixtures are not interface. Lint enforces the
 * rule; this lists every hit with `--list`, ignoring the `allow` option.
 */
import { ESLint } from 'eslint';
import ts from 'typescript-eslint';
import svelteParser from 'svelte-eslint-parser';
import { relative } from 'node:path';
import rule from '../eslint-rules/no-literal-ui-text.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const RULE = 'custom/no-literal-ui-text';

const eslint = new ESLint({
	cwd: ROOT,
	overrideConfigFile: true,
	overrideConfig: [
		{ ignores: ['**/*.test.svelte', '**/*Harness.svelte'] },
		{
			files: ['**/*.svelte'],
			languageOptions: { parser: svelteParser, parserOptions: { parser: ts.parser } },
			plugins: { custom: { rules: { 'no-literal-ui-text': rule } } },
			rules: { [RULE]: 'warn' }
		}
	]
});

const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = await eslint.lintFiles(paths.length ? paths : ['src/**/*.svelte']);

/** @type {Map<string, number>} */ const byDir = new Map();
/** @type {[string, number][]} */ const byFile = [];
let total = 0;

for (const r of results) {
	const hits = r.messages.filter((m) => m.ruleId === RULE);
	if (!hits.length) continue;
	const file = relative(ROOT, r.filePath);
	total += hits.length;
	byFile.push([file, hits.length]);
	const dir = file.split('/').slice(0, 4).join('/');
	byDir.set(dir, (byDir.get(dir) ?? 0) + hits.length);
	if (process.argv.includes('--list'))
		for (const m of hits) console.log(`${file}:${m.line}  ${m.message.split('" is')[0]}"`);
}

/** @param {Map<string, number>} m */
const sorted = (m) => [...m].sort((a, b) => b[1] - a[1]);

if (process.argv.includes('--json')) {
	console.log(
		JSON.stringify(
			{ total, files: byFile.length, byDir: Object.fromEntries(sorted(byDir)) },
			null,
			2
		)
	);
} else {
	console.log(`\n${total} literal interface strings in ${byFile.length} files\n`);
	console.log('── by directory ──');
	for (const [dir, n] of sorted(byDir)) console.log(`  ${String(n).padStart(5)}  ${dir}`);
	console.log('\n── worst files ──');
	for (const [file, n] of byFile.sort((a, b) => b[1] - a[1]).slice(0, 15))
		console.log(`  ${String(n).padStart(5)}  ${file}`);
	console.log();
}
