#!/usr/bin/env node
/**
 * Field-name census — hand-written `name`s on controls in remote forms (#2196).
 *
 *   node scripts/field-name-census.mjs           # report by directory and file
 *   node scripts/field-name-census.mjs --list    # every hit, file:line
 *   node scripts/field-name-census.mjs --json    # machine-readable totals
 *
 * Runs `custom/no-manual-field-name` with `outsideForm`, so a name-only control
 * in a file with no form of its own is listed too: it is a hit when the file is
 * rendered inside a remote form somewhere else, and needs reading to tell.
 */
import { ESLint } from 'eslint';
import ts from 'typescript-eslint';
import svelteParser from 'svelte-eslint-parser';
import { relative } from 'node:path';
import rule from '../eslint-rules/no-manual-field-name.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const RULE = 'custom/no-manual-field-name';

const eslint = new ESLint({
	cwd: ROOT,
	overrideConfigFile: true,
	overrideConfig: [
		{ ignores: ['**/*.test.svelte', '**/*Harness.svelte'] },
		{
			files: ['**/*.svelte'],
			languageOptions: { parser: svelteParser, parserOptions: { parser: ts.parser } },
			plugins: { custom: { rules: { 'no-manual-field-name': rule } } },
			rules: { [RULE]: ['warn', { outsideForm: true }] }
		}
	]
});

const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = await eslint.lintFiles(paths.length ? paths : ['src/**/*.svelte']);

/** @type {Map<string, { remote: number, outside: number }>} */ const byDir = new Map();
/** @type {[string, number, number][]} */ const byFile = [];
const totals = { remote: 0, outside: 0 };

for (const r of results) {
	const hits = r.messages.filter((m) => m.ruleId === RULE);
	if (!hits.length) continue;
	const file = relative(ROOT, r.filePath);
	const outside = hits.filter((m) => m.messageId === 'outsideForm').length;
	const remote = hits.length - outside;
	totals.remote += remote;
	totals.outside += outside;
	byFile.push([file, remote, outside]);
	const dir = file.split('/').slice(0, 4).join('/');
	const d = byDir.get(dir) ?? { remote: 0, outside: 0 };
	d.remote += remote;
	d.outside += outside;
	byDir.set(dir, d);
	if (process.argv.includes('--list'))
		for (const m of hits)
			console.log(`${file}:${m.line}  ${m.messageId === 'outsideForm' ? 'outside' : 'remote'}`);
}

const sum = (/** @type {{ remote: number, outside: number }} */ v) => v.remote + v.outside;
const sortedDirs = [...byDir].sort((a, b) => sum(b[1]) - sum(a[1]));

if (process.argv.includes('--json')) {
	console.log(
		JSON.stringify(
			{ ...totals, files: byFile.length, byDir: Object.fromEntries(sortedDirs) },
			null,
			2
		)
	);
} else {
	console.log(
		`\n${totals.remote} in a remote form, ${totals.outside} outside any form, in ${byFile.length} files\n`
	);
	console.log('── by directory (remote / outside) ──');
	for (const [dir, v] of sortedDirs)
		console.log(`  ${String(v.remote).padStart(4)} / ${String(v.outside).padEnd(4)} ${dir}`);
	console.log();
}
