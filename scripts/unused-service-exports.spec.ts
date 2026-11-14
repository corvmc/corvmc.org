import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A service function whose last caller went with a page (#2903) stays behind
 * with its spec, tested and unreachable. Every exported function in a
 * `*-service.ts` must be named by some other non-spec source file, or used in
 * its own. A word match, so it can miss dead code but never invents any.
 */
const SERVICES = ['src/lib/server/**/*-service.ts'];
const SOURCES = ['src/**/*.{ts,js,svelte}', 'scripts/**/*.{ts,mjs}', 'e2e/**/*.ts'];

/** Unused before this gate, as `path → name`. Remove an entry when its function goes. */
const GRANDFATHERED: string[] = JSON.parse(
	readFileSync('scripts/unused-service-exports.json', 'utf8')
);

function unused(): string[] {
	const files = sourceFiles(SOURCES, new Set()).filter((f) => !/\.spec\.[jt]s$/.test(f));
	const words = new Map(files.map((f) => [f, readFileSync(f, 'utf8').match(/\w+/g) ?? []]));
	const found: string[] = [];
	for (const service of sourceFiles(SERVICES, new Set())) {
		const own = words.get(service) ?? [];
		const source = readFileSync(service, 'utf8');
		for (const [, name] of source.matchAll(/^export (?:async )?function (\w+)/gm)) {
			if (own.filter((w) => w === name).length > 1) continue;
			const elsewhere = [...words].some(([f, ws]) => f !== service && ws.includes(name));
			if (!elsewhere) found.push(`${service} → ${name}`);
		}
	}
	return found;
}

describe('service exports', () => {
	const found = unused();

	it('are each called from outside their specs', () => {
		expect(found.filter((f) => !GRANDFATHERED.includes(f))).toEqual([]);
	});

	it('leave no allowlist entry for a function that is used or gone', () => {
		expect(GRANDFATHERED.filter((f) => !found.includes(f))).toEqual([]);
	});
});
