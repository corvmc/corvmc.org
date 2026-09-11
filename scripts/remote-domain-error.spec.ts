import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A `DomainError` that reaches SvelteKit unmapped is a 500 reading "Internal
 * Error" and a business rule filed in Sentry as a crash — `hooks.server.ts`
 * guards on `status >= 500`, and a `DomainError` is not an `HttpError`. Every
 * call from a remote function into a service that throws one has to sit inside
 * a `try` whose `catch` calls `mapDomainError`. #921 counted 26 remote modules
 * without the mapper; this is what stops the next vertical drifting back.
 */
const SERVER_GLOBS = ['src/lib/server/**/*.ts'];
const REMOTE_GLOB = ['src/lib/remote/*.remote.ts'];

/**
 * Call sites that predate the gate, as a path list rather than a count — a
 * count is a whole-tree snapshot that any PR merging alongside yours
 * invalidates, and two PRs editing this list conflict in git instead, which is
 * visible. Every one of these is a `DomainError` reaching the browser as a
 * 500; they are in files #921's `grep -L mapDomainError` could not see, because
 * those files already use the mapper somewhere else.
 */
const GRANDFATHERED: string[] = JSON.parse(
	readFileSync('scripts/remote-domain-error.json', 'utf8')
);

/** Every class that reaches `DomainError` by any chain of `extends`. */
function domainErrorNames(sources: Map<string, string>): Set<string> {
	const names = new Set(['DomainError']);
	for (let pass = 0; pass < 8; pass++) {
		let grew = false;
		for (const source of sources.values()) {
			for (const m of source.matchAll(/class\s+(\w+)\s+extends\s+(\w+)/g)) {
				if (names.has(m[2]) && !names.has(m[1])) {
					names.add(m[1]);
					grew = true;
				}
			}
		}
		if (!grew) break;
	}
	names.delete('DomainError');
	return names;
}

/** Top-level exported functions, by name, with their source text. */
function exportedBodies(source: string): Map<string, string> {
	const marks = [
		...source.matchAll(/export (?:async )?function (\w+)/g),
		...source.matchAll(/export const (\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g)
	]
		.map((m) => ({ at: m.index, name: m[1] }))
		.sort((a, b) => a.at - b.at);

	const bodies = new Map<string, string>();
	marks.forEach(({ at, name }, i) => {
		bodies.set(name, source.slice(at, marks[i + 1]?.at ?? source.length));
	});
	return bodies;
}

/**
 * Which exports of each server module throw a `DomainError` themselves.
 *
 * Direct throws only. Following calls between functions finds more, and also
 * over-reports — a name matched by `\bfoo\s*\(` is not always the import — and
 * a gate that tells an author to wrap a call that cannot throw is one they
 * learn to work around.
 */
function throwingExports(sources: Map<string, string>): Map<string, Set<string>> {
	const thrown = [...domainErrorNames(sources)];
	const pattern = new RegExp(`throw new (${thrown.join('|')})\\b`);
	const bodies = new Map([...sources].map(([f, s]) => [f, exportedBodies(s)] as const));

	const throwing = new Map<string, Set<string>>(
		[...bodies].map(([f, b]) => [
			f,
			new Set([...b].filter(([, t]) => pattern.test(t)).map(([n]) => n))
		])
	);

	return throwing;
}

/** Named imports from server modules: local name → the module and export it came from. */
function importsOf(source: string, from: string): Map<string, { file: string; name: string }> {
	const out = new Map<string, { file: string; name: string }>();
	for (const m of source.matchAll(
		/import\s*\{([^}]*)\}\s*from\s*'(\$lib\/server\/[^']+|\.\/[^']+)'/gs
	)) {
		const file = m[2].startsWith('$lib')
			? `${m[2].replace('$lib/server', 'src/lib/server')}.ts`
			: `${from.slice(0, from.lastIndexOf('/'))}/${m[2].slice(2)}.ts`;
		for (const raw of m[1].split(',')) {
			const spec = raw.trim();
			if (!spec || spec.startsWith('type ')) continue;
			const [name, local = name] = spec.split(' as ').map((p) => p.trim());
			out.set(local, { file, name });
		}
	}
	return out;
}

/** Character ranges of every `try` block whose `catch` calls `mapDomainError`. */
function mappedTryRanges(source: string): [number, number][] {
	const ranges: [number, number][] = [];
	for (const m of source.matchAll(/\btry\s*\{/g)) {
		let depth = 1;
		let i = m.index + m[0].length;
		while (i < source.length && depth > 0) {
			if (source[i] === '{') depth++;
			else if (source[i] === '}') depth--;
			i++;
		}
		// The catch clause runs to the end of its own block; reading the next 400
		// characters is enough to see whether the mapper is the thing in it.
		if (/catch\s*\([^)]*\)\s*\{[^}]*mapDomainError/.test(source.slice(i, i + 400))) {
			ranges.push([m.index, i]);
		}
	}
	return ranges;
}

/** From a call's `(` to just past its matching `)`, so the tail can be read. */
function closingParenOnwards(source: string, at: number): string {
	let i = source.indexOf('(', at);
	let depth = 1;
	i++;
	while (i < source.length && depth > 0) {
		if (source[i] === '(') depth++;
		else if (source[i] === ')') depth--;
		i++;
	}
	return source.slice(i - 1, i + 120);
}

function unmappedCalls(file: string, throwing: Map<string, Set<string>>): string[] {
	const source = readFileSync(file, 'utf8');
	const mapped = mappedTryRanges(source);
	const offenders = new Set<string>();

	for (const [local, origin] of importsOf(source, file)) {
		if (!throwing.get(origin.file)?.has(origin.name)) continue;
		for (const call of source.matchAll(new RegExp(`\\b${local}\\s*\\(`, 'g'))) {
			const at = call.index;
			// The import statement itself is not a call site.
			if (source.slice(0, at).lastIndexOf('import') > source.slice(0, at).lastIndexOf(';'))
				continue;
			if (mapped.some(([start, end]) => at > start && at < end)) continue;
			// `foo(x).catch(mapDomainError)` maps as surely as a try/catch does,
			// and reads better for a one-call handler. Two real sites were being
			// reported as unmapped because only the block form was recognised.
			if (/^\s*\)?[^;\n]*\.catch\(mapDomainError\)/.test(closingParenOnwards(source, at))) continue;
			offenders.add(local);
		}
	}
	return [...offenders].sort();
}

describe('remote functions and domain errors', () => {
	it('never calls a throwing service outside a try that maps the error', () => {
		const server = new Map(
			sourceFiles(SERVER_GLOBS, new Set())
				.filter((f) => !f.endsWith('.spec.ts'))
				.map((f) => [f, readFileSync(f, 'utf8')] as const)
		);
		const throwing = throwingExports(server);

		const grandfathered = new Set(GRANDFATHERED);
		const found = sourceFiles(REMOTE_GLOB, new Set())
			.flatMap((file) => unmappedCalls(file, throwing).map((fn) => `${file} → ${fn}()`))
			.sort();
		const offenders = found.filter((o) => !grandfathered.has(o));

		expect(
			offenders,
			`These calls can throw a DomainError that nothing maps, so the browser gets ` +
				`a 500 reading "Internal Error" and Sentry files a business rule as a crash. ` +
				`Wrap each in try/catch and call mapDomainError:\n` +
				`${offenders.map((o) => `  ${o}`).join('\n')}\n`
		).toEqual([]);

		const fixed = GRANDFATHERED.filter((o) => !found.includes(o)).sort();
		expect(
			fixed,
			`These are mapped now. Delete them from scripts/remote-domain-error.json, ` +
				`so the next change cannot spend what this one freed:\n` +
				`${fixed.map((o) => `  ${o}`).join('\n')}\n`
		).toEqual([]);
	});
});
