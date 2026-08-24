import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compile } from 'svelte/compiler';
import ts from 'typescript';

/**
 * Guards against the class of bug behind JAVASCRIPT-SVELTEKIT-25.
 *
 * Svelte compiles a template node that awaits into
 * `$.async(node, blockers, expressions, fn)`, which calls `flatten()`. When
 * *both* arrays are non-empty, `flatten` defers to
 * `blocker_promise.then(() => { restore(); run(); })`. `restore()` optional-
 * chains the captured batch — `previous_batch?.activate()`, with an upstream
 * TODO conceding it can be null — but `async_derived` then casts `current_batch`
 * to non-null and dereferences `batch.async_deriveds`. A null batch there is an
 * unhandled TypeError that kills the page, and every button on it.
 *
 * Blockers come from declarations that follow a top-level `await`; expressions
 * come from `{#each await …}` and friends. Either alone is safe: no blockers
 * takes `flatten`'s synchronous path, no expressions takes its fast path, which
 * never calls `async_derived` at all. Only the combination is broken, and no
 * published Svelte (nor `main`) fixes it — so the shape has to be kept out of
 * the tree.
 *
 * The fix is normally to declare the awaited value *above* the top-level awaits,
 * as `routes/member/reservations/+page.svelte` and
 * `routes/staff/suggestions/[id]/+page.svelte` do; splitting the component so
 * the awaits and the async template expression sit on opposite sides of a prop
 * boundary (as `routes/member/profile/` does) works too.
 *
 * Both of those pages have carried this shape twice now — the source reads as
 * completely ordinary, which is why the guard is worth its runtime.
 */

const SRC = new URL('.', import.meta.url).pathname;

function svelteFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...svelteFiles(full));
		else if (entry.name.endsWith('.svelte')) out.push(full);
	}
	return out;
}

/**
 * True when the generated module contains a `$.async(node, [...], [...], fn)`
 * call with both a non-empty blockers array and a non-empty expressions array.
 *
 * Parsed rather than string-matched on purpose. Svelte copies script comments
 * into its output, so a scan over raw text is defeated by a source comment that
 * merely *mentions* the shape — which is exactly what the comment documenting
 * this bug in the reservations page does. A regex is worse still: the obvious
 * `\[([^\]]*)\]` reports zero offenders forever, because the blockers array is
 * spelled `[$$promises[3]]` and the inner `]` ends the match early.
 */
function hasBlockedAsyncExpression(code: string, filename: string): boolean {
	const source = ts.createSourceFile(
		filename,
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
	const nonEmptyArray = (node: ts.Node | undefined) =>
		Boolean(node && ts.isArrayLiteralExpression(node) && node.elements.length > 0);

	let found = false;
	const visit = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === '$' &&
			node.expression.name.text === 'async' &&
			nonEmptyArray(node.arguments[1]) &&
			nonEmptyArray(node.arguments[2])
		) {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

describe('async template effects', () => {
	// Compiling every component is a few seconds of real work — ~2.5s on an idle
	// machine, 6.5s on CI's slower runners, which overran vitest's 5s default.
	// The bound is deliberately far above either: sharing a machine with the
	// chromium project pushed one full-suite run of this test to 328s. A generous
	// timeout costs nothing when things are fast, and a guard that can go red
	// without naming an offender is worse than a slow one.
	it('never combine blockers with async expressions', { timeout: 600_000 }, () => {
		const files = svelteFiles(SRC);
		// Canary: if the walk ever stops finding components, the assertion below
		// passes vacuously and this guard is silently dead.
		expect(files.length).toBeGreaterThan(100);

		const offenders = files
			.filter((file) => {
				const { js } = compile(readFileSync(file, 'utf8'), {
					generate: 'client',
					// Matches svelte.config.js: runes everywhere except the mdsvex layouts.
					// Leave TypeScript in place — Svelte 5 parses `lang="ts"` natively,
					// including TS in template expressions.
					runes: !file.includes('/layouts/'),
					experimental: { async: true },
					filename: file
				});
				return hasBlockedAsyncExpression(js.code, file);
			})
			.map((file) => relative(SRC, file));

		expect(offenders).toEqual([]);
	});
});
