import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { appReport, optionKey } from './lib/app-form-reachability';
import type { Report } from './lib/form-reachability';

/**
 * A service option no `form()` or `command()` passes is a capability nobody can
 * reach (#2049). Each one is listed in `form-reachability.allow.json` under its
 * function, with a reason that starts `internal:` (only a job, listener, seed or
 * other service sets it), `elsewhere:` (another form writes the same column) or
 * `#<issue>:` (a real gap, until it is fixed).
 */
const LISTED: Record<string, Record<string, string>> = JSON.parse(
	readFileSync('scripts/form-reachability.allow.json', 'utf8')
);
const ALLOWED = new Map(
	Object.entries(LISTED).flatMap(([fn, keys]) =>
		Object.entries(keys).map(([key, why]) => [`${fn}.${key}`, why] as const)
	)
);

describe('every service option is reachable from a form, or listed', () => {
	let report: Report;
	// Builds the whole app's TypeScript program: seconds, not milliseconds.
	beforeAll(() => {
		report = appReport();
	}, 120_000);

	it('reads the remotes', () => {
		// A parser change that drops most of them would otherwise pass vacuously.
		expect(report.remotes).toBeGreaterThan(500);
	});

	it('lists every unreached option', () => {
		const found = report.unreached.map(optionKey);
		const unlisted = found.filter((k) => !ALLOWED.has(k));
		expect(
			unlisted,
			`No form() or command() passes these service options. Add them to a form, or ` +
				`list them in scripts/form-reachability.allow.json with an internal:, ` +
				`elsewhere: or #<issue>: reason. \`pnpm form-reachability\` shows the callers:\n` +
				`${unlisted.map((k) => `  ${k}`).join('\n')}\n`
		).toEqual([]);

		const stale = [...ALLOWED.keys()].filter((k) => !found.includes(k));
		expect(
			stale,
			`A form reaches these now, or they no longer exist. Delete them from ` +
				`scripts/form-reachability.allow.json:\n${stale.map((s) => `  ${s}`).join('\n')}\n`
		).toEqual([]);
	});

	it('gives every listed option a classified reason', () => {
		const bare = [...ALLOWED]
			.filter(([, why]) => !/^(internal|elsewhere|#\d+): \S.{8,}/.test(why))
			.map(([k]) => k);
		expect(bare).toEqual([]);
	});
});
