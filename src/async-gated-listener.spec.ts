import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compile } from 'svelte/compiler';
import ts from 'typescript';

/**
 * Guards against the class of bug behind JAVASCRIPT-SVELTEKIT-2S.
 *
 * Under `experimental.async`, every declaration that follows a top-level
 * `await` is async-gated. Svelte emits the component body as
 * `$.run([async () => …await…, () => { /* everything after *\/ }])`, and the
 * second thunk runs only once the first has settled. Until then those bindings
 * are bare `var`s holding `undefined`.
 *
 * `<svelte:window onclick={…}>` is not gated. It compiles to a bare
 * `$.event('click', $.window, handler)` in the template body, attached
 * synchronously during setup. So a component that awaits at the top and binds a
 * window listener has a window — exactly one round trip wide — in which the
 * listener is live and the state it reads does not exist yet. Reading an absent
 * signal is `$.get(undefined)`, which dereferences `.f` and throws
 * `undefined is not an object (evaluating 'e.f')`.
 *
 * That window is invisible in every ordinary test, because mocked queries
 * resolve before anyone can click. It is wide open on a phone on a slow
 * connection, which is where both reports came from — one user, one minute,
 * `NotificationBell` and `AccountDropdown`, the two components mounted in
 * `AppTopbar` on every authenticated page.
 *
 * Guarding against `undefined` inside the handler does not work: the guard flag
 * is gated too, reads `undefined`, and waves the click straight through. The fix
 * is to declare the listener's state *above* the awaited derived, leaving only
 * genuinely `data`-derived values gated.
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

const isSvelteCall = (node: ts.Node, name: string): node is ts.CallExpression =>
	ts.isCallExpression(node) &&
	ts.isPropertyAccessExpression(node.expression) &&
	ts.isIdentifier(node.expression.expression) &&
	node.expression.expression.text === '$' &&
	node.expression.name.text === name;

/**
 * Names bound by an async-gated declaration that a synchronously-attached event
 * listener can reach. Empty means the component is safe.
 *
 * Reachability matters: `notifications` and `unreadCount` in `NotificationBell`
 * are legitimately gated — they derive from the awaited value and are read only
 * inside `$.async` template nodes, which wait for the same promise. Flagging
 * every gated name would condemn the correct shape along with the broken one.
 */
function gatedStateReachableFromSyncListener(code: string, filename: string): string[] {
	const source = ts.createSourceFile(
		filename,
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);

	// 1. Names assigned inside the gated continuation(s) of `$.run([...])`.
	const gated = new Set<string>();
	// 2. Handlers passed to `$.event(...)` reached without going through `$.async`.
	const syncHandlers = new Set<string>();
	// 3. Every function declaration, so handler bodies can be followed.
	const fns = new Map<string, ts.Node>();

	const collectAssignments = (node: ts.Node) => {
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isIdentifier(node.left)
		) {
			gated.add(node.left.text);
		}
		ts.forEachChild(node, collectAssignments);
	};

	// `insideAsync` tracks whether we are within an `$.async(...)` callback, whose
	// contents are deferred on the same promise and therefore safe.
	const visit = (node: ts.Node, insideAsync: boolean) => {
		if (ts.isFunctionDeclaration(node) && node.name) fns.set(node.name.text, node);

		if (isSvelteCall(node, 'run')) {
			const arr = node.arguments[0];
			if (arr && ts.isArrayLiteralExpression(arr)) {
				arr.elements.slice(1).forEach(collectAssignments);
			}
		}

		if (isSvelteCall(node, 'event') && !insideAsync) {
			node.arguments.forEach((arg) => {
				if (ts.isIdentifier(arg)) syncHandlers.add(arg.text);
			});
		}

		const nowInsideAsync = insideAsync || isSvelteCall(node, 'async');
		ts.forEachChild(node, (child) => visit(child, nowInsideAsync));
	};
	visit(source, false);

	if (!gated.size || !syncHandlers.size) return [];

	// Follow each handler through the local functions it calls, collecting reads.
	const reads = new Set<string>();
	const seen = new Set<string>();
	const follow = (name: string) => {
		if (seen.has(name)) return;
		seen.add(name);
		const fn = fns.get(name);
		if (!fn) return;
		const walk = (node: ts.Node) => {
			if (ts.isIdentifier(node)) {
				reads.add(node.text);
				if (fns.has(node.text)) follow(node.text);
			}
			ts.forEachChild(node, walk);
		};
		ts.forEachChild(fn, walk);
	};
	syncHandlers.forEach(follow);

	return [...gated].filter((name) => reads.has(name)).sort();
}

// ---------------------------------------------------------------------------
// Canaries — the detector has to actually detect
// ---------------------------------------------------------------------------

const compileSource = (source: string, filename: string) =>
	compile(source, {
		generate: 'client',
		// Matches svelte.config.js, as `async-effect-shape.spec.ts` does: runes
		// everywhere except the mdsvex prose layout, which still uses `export let`.
		runes: !filename.includes('/markdown/prose.svelte'),
		experimental: { async: true },
		filename
	}).js.code;

/** The shape as it shipped: `open` declared after the awaited derived. */
const BROKEN = `<script>
	import { getThing } from '$lib/remote/thing.remote';
	let data = $derived(await getThing());
	let open = $state(false);
	function handleClickOutside() { open = false; }
</script>
<svelte:window onclick={handleClickOutside} />
<div>{data}{#if open}x{/if}</div>`;

/** The fix: the listener's state declared above the await, derived values below. */
const FIXED = `<script>
	import { getThing } from '$lib/remote/thing.remote';
	let open = $state(false);
	let data = $derived(await getThing());
	let label = $derived(data.label);
	function handleClickOutside() { open = false; }
</script>
<svelte:window onclick={handleClickOutside} />
<div>{label}{#if open}x{/if}</div>`;

describe('async-gated state behind a synchronous window listener', () => {
	it('detects state declared after a top-level await', () => {
		expect(
			gatedStateReachableFromSyncListener(compileSource(BROKEN, 'Broken.svelte'), 'x')
		).toEqual(['open']);
	});

	it('clears the same component once the state is hoisted above the await', () => {
		expect(gatedStateReachableFromSyncListener(compileSource(FIXED, 'Fixed.svelte'), 'x')).toEqual(
			[]
		);
	});

	// Compiling every component is a few seconds of real work, and shares a
	// machine with the chromium project on CI. Bounded generously for the same
	// reason as `async-effect-shape.spec.ts`.
	it('never ships a component with the shape', { timeout: 600_000 }, () => {
		const files = svelteFiles(SRC);
		// Canary: if the walk stops finding components the assertion below passes
		// vacuously and this guard is silently dead.
		expect(files.length).toBeGreaterThan(100);

		const offenders = files
			.map((file) => {
				const js = compileSource(readFileSync(file, 'utf8'), file);
				const names = gatedStateReachableFromSyncListener(js, file);
				return names.length ? `${relative(SRC, file)}: ${names.join(', ')}` : null;
			})
			.filter(Boolean);

		expect(offenders).toEqual([]);
	});
});
