import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { NOTIFICATION_TYPES, holdsForDigest } from '#lib/server/db/schema/notification.js';

/**
 * A `digestIfLater` notice with no `happensAt` is delivered at once, which is
 * the same as a type that was never classified (#3409).
 *
 * The dispatcher cannot tell "the caller has no time" from "the caller forgot
 * it", so the call site has to say which: a `Date`, or `null` for a subject
 * with no time. Walking every `dispatch`/`dispatchBatch` call is the cheapest
 * place to catch a new sender that says nothing.
 */

const IF_LATER = new Set(
	NOTIFICATION_TYPES.filter((t) => t.inAppDelivery === 'digestIfLater').map((t) => t.key)
);

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...sourceFiles(path));
		else if (entry.name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(entry.name)) found.push(path);
	}
	return found;
}

interface Call {
	file: string;
	line: number;
	type: string | null;
	hasHappensAt: boolean;
}

/** Every `dispatch({...})` / `dispatchBatch({...})` in the tree, as written. */
function dispatchCalls(): Call[] {
	const calls: Call[] = [];
	for (const file of sourceFiles('src')) {
		const text = readFileSync(file, 'utf8');
		if (!/\bdispatch(Batch)?\(/.test(text)) continue;
		const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		const visit = (node: ts.Node) => {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				['dispatch', 'dispatchBatch'].includes(node.expression.text) &&
				node.arguments[0] &&
				ts.isObjectLiteralExpression(node.arguments[0])
			) {
				const props = node.arguments[0].properties;
				const named = (name: string) =>
					props.find(
						(p): p is ts.PropertyAssignment =>
							ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name
					);
				const type = named('type')?.initializer;
				calls.push({
					file,
					line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
					type: type && ts.isStringLiteralLike(type) ? type.text : null,
					hasHappensAt: props.some(
						(p) =>
							ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'happensAt'
					)
				});
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
	return calls;
}

describe('digestIfLater notices state when they happen', () => {
	const calls = dispatchCalls();

	it('finds the senders it is meant to guard', () => {
		expect(calls.filter((c) => c.type && IF_LATER.has(c.type)).length).toBeGreaterThan(10);
	});

	it('reads the type of every call from a literal', () => {
		const unread = calls.filter((c) => c.type === null).map((c) => `${c.file}:${c.line}`);
		expect(unread).toEqual([]);
	});

	it('passes happensAt on every digestIfLater call, a Date or an explicit null', () => {
		const silent = calls
			.filter((c) => c.type && IF_LATER.has(c.type) && !c.hasHappensAt)
			.map((c) => `${c.file}:${c.line} ${c.type}`);
		expect(silent).toEqual([]);
	});
});

describe('holdsForDigest with a stated time', () => {
	const now = new Date('2026-06-10T18:00:00Z');
	const hours = (n: number) => new Date(now.getTime() + n * 3_600_000);

	it('holds every digestIfLater type more than a day out and releases it inside a day', () => {
		for (const key of IF_LATER) {
			expect(holdsForDigest(key, hours(48), now), key).toBe(true);
			expect(holdsForDigest(key, hours(2), now), key).toBe(false);
			expect(holdsForDigest(key, null, now), key).toBe(false);
		}
	});
});
