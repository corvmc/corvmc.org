import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { sourceFiles } from './lib/source-files';
import { CallGraph, walkEvents, type Key } from './lib/remote-calls';

/**
 * Kit 3 throws on `event.url`, `params` and `route` inside a `query()`: a query
 * is cached and shared by every page that calls it, so it has no page of its
 * own. A query that needs the path takes it as an argument. This walks each
 * query's handler and every `src/lib` function it reaches, and fails on a read
 * of those three from `getRequestEvent()`.
 */
const REMOTE_GLOB = ['src/lib/remote/*.remote.ts'];
const PAGE_SCOPED = new Set(['url', 'params', 'route']);

function isRequestEventCall(n: ts.Node): boolean {
	let e = n;
	while (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
	return (
		ts.isCallExpression(e) &&
		ts.isIdentifier(e.expression) &&
		e.expression.text === 'getRequestEvent'
	);
}

/** `getRequestEvent().url`, `const { url } = getRequestEvent()`, `event.url` after `const event = getRequestEvent()`. */
function pageScopedReads(body: ts.Node): string[] {
	const sf = body.getSourceFile();
	const events = new Set<string>();
	const hits: string[] = [];
	const at = (n: ts.Node, name: string) =>
		hits.push(`${name} at line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
	const visit = (n: ts.Node) => {
		if (ts.isVariableDeclaration(n) && n.initializer && isRequestEventCall(n.initializer)) {
			if (ts.isIdentifier(n.name)) events.add(n.name.text);
			else if (ts.isObjectBindingPattern(n.name)) {
				for (const el of n.name.elements) {
					const key = (el.propertyName ?? el.name) as ts.Node;
					if (ts.isIdentifier(key) && PAGE_SCOPED.has(key.text)) at(el, key.text);
				}
			}
		}
		if (ts.isPropertyAccessExpression(n) && PAGE_SCOPED.has(n.name.text)) {
			const base = n.expression;
			if (isRequestEventCall(base) || (ts.isIdentifier(base) && events.has(base.text)))
				at(n, n.name.text);
		}
		ts.forEachChild(n, visit);
	};
	visit(body);
	return hits;
}

describe('queries do not read the page from the request event', () => {
	const g = new CallGraph();
	const queries = g.remotes(sourceFiles(REMOTE_GLOB, new Set())).filter((r) => r.kind === 'query');

	it('finds the queries', () => {
		expect(queries.length).toBeGreaterThan(300);
	});

	it('detects each shape it looks for', () => {
		const src = `function f() {
			const { url, locals } = getRequestEvent();
			const event = getRequestEvent();
			event.params.slug;
			getRequestEvent().route.id;
			event.locals.user;
		}`;
		const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true);
		expect(pageScopedReads(sf).map((h) => h.split(' ')[0])).toEqual(['url', 'params', 'route']);
	});

	it('reach no event.url, params or route', () => {
		const offenders: string[] = [];
		for (const q of queries) {
			const seen = new Set<Key>([q.key]);
			const stack: Key[] = [q.key];
			while (stack.length) {
				const key = stack.pop()!;
				const body = g.body(key);
				if (!body) continue;
				for (const hit of pageScopedReads(body.node)) offenders.push(`${q.key} → ${key}: ${hit}`);
				walkEvents(g, body.mod, body.node, (e) => {
					if (e.kind === 'call' && !seen.has(e.key)) {
						seen.add(e.key);
						stack.push(e.key);
					}
					return undefined;
				});
			}
		}
		expect(offenders).toEqual([]);
	});
});
