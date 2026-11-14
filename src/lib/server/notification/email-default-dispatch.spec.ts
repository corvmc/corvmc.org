import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from '../../../../scripts/lib/source-files';
import { NOTIFICATION_TYPES } from '#lib/server/db/schema/notification.js';

/**
 * `dispatch` sends no email without `email` content, whatever the type's
 * default. A type that defaults email on but is dispatched without it shows
 * the preference and never sends: teaching applications reached staff only in
 * the bell (#2809), and shift invitations the same way.
 */
const EMAIL_ON = new Set(NOTIFICATION_TYPES.filter((t) => t.defaults.email).map((t) => t.key));

/** Each `dispatch({ ... })` / `dispatchBatch({ ... })` argument, with its file and line. */
function dispatchCalls(file: string): { at: string; body: string }[] {
	const source = readFileSync(file, 'utf8');
	const calls: { at: string; body: string }[] = [];
	for (const m of source.matchAll(/\bdispatch(?:Batch)?\(\{/g)) {
		const start = m.index + m[0].length - 1;
		let depth = 0;
		let end = start;
		for (; end < source.length; end++) {
			if (source[end] === '{') depth++;
			else if (source[end] === '}' && --depth === 0) break;
		}
		const line = source.slice(0, start).split('\n').length;
		calls.push({ at: `${file}:${line}`, body: source.slice(start, end + 1) });
	}
	return calls;
}

describe('notification dispatches', () => {
	const calls = sourceFiles(['src/lib/**/*.ts'], new Set())
		.filter((f) => !f.endsWith('.spec.ts'))
		.flatMap(dispatchCalls);

	it('are found, so an empty pass means something', () => {
		expect(calls.length).toBeGreaterThan(20);
	});

	it('carry email content when their type defaults email on', () => {
		const silent = calls
			.filter(({ body }) => {
				const type = /\btype:\s*'(\w+)'/.exec(body)?.[1];
				return type && EMAIL_ON.has(type) && !/(?<![.\w])email\s*[,:}\n]/.test(body);
			})
			.map(({ at }) => at);

		expect(silent).toEqual([]);
	});
});
