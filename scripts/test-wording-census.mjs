#!/usr/bin/env node
/**
 * Test-wording census — counts tests that locate or assert by UI copy (#2189).
 *
 *   node scripts/test-wording-census.mjs          # report by directory and file
 *   node scripts/test-wording-census.mjs --json   # machine-readable totals
 *
 * Runs `custom/no-wording-locators` alone over e2e/ and every `*.spec.ts`. The
 * rule is off in eslint.config.js because lint is `--max-warnings 0`; this is
 * the backlog's scoreboard until it reaches zero and the rule is switched on.
 */
import { ESLint } from 'eslint';
import ts from 'typescript-eslint';
import { relative } from 'node:path';
import rule from '../eslint-rules/no-wording-locators.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const RULE = 'custom/no-wording-locators';

const eslint = new ESLint({
	cwd: ROOT,
	overrideConfigFile: true,
	overrideConfig: [
		{ ignores: ['**/node_modules/**', '.svelte-kit/**', 'eslint-rules/**'] },
		{
			files: ['**/*.ts'],
			languageOptions: { parser: ts.parser },
			plugins: { custom: { rules: { 'no-wording-locators': rule } } },
			rules: { [RULE]: 'warn' }
		}
	]
});

const results = await eslint.lintFiles(['e2e/**/*.ts', '**/*.spec.ts']);

/** @type {Map<string, number>} */ const byMessage = new Map();
/** @type {Map<string, number>} */ const byDir = new Map();
/** @type {[string, number][]} */ const byFile = [];
let total = 0;

for (const r of results) {
	const hits = r.messages.filter((m) => m.ruleId === RULE);
	if (!hits.length) continue;
	const file = relative(ROOT, r.filePath);
	total += hits.length;
	byFile.push([file, hits.length]);
	const dir = file
		.split('/')
		.slice(0, file.startsWith('src/') ? 4 : 1)
		.join('/');
	byDir.set(dir, (byDir.get(dir) ?? 0) + hits.length);
	for (const m of hits) {
		const kind = m.messageId ?? 'unknown';
		byMessage.set(kind, (byMessage.get(kind) ?? 0) + 1);
	}
}

/** @param {Map<string, number>} m */
const sorted = (m) => [...m].sort((a, b) => b[1] - a[1]);

if (process.argv.includes('--json')) {
	console.log(
		JSON.stringify(
			{
				total,
				files: byFile.length,
				byKind: Object.fromEntries(byMessage),
				byDir: Object.fromEntries(sorted(byDir))
			},
			null,
			2
		)
	);
} else {
	console.log(`\n${total} wording locators/assertions in ${byFile.length} files\n`);
	for (const [kind, n] of sorted(byMessage)) console.log(`  ${String(n).padStart(5)}  ${kind}`);
	console.log('\n── by directory ──');
	for (const [dir, n] of sorted(byDir)) console.log(`  ${String(n).padStart(5)}  ${dir}`);
	console.log('\n── worst files ──');
	for (const [file, n] of byFile.sort((a, b) => b[1] - a[1]).slice(0, 15))
		console.log(`  ${String(n).padStart(5)}  ${file}`);
	console.log();
}
